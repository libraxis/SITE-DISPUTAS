const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const PNCP = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";
const CACHE_MS = 5 * 60 * 1000;
const DIAS_A_FRENTE = 0;
const SITUACAO_DIVULGADA_ID = 1;
const SITUACAO_DIVULGADA_NOME = "Divulgada no PNCP";
const cache = new Map();

/*
  Modalidades documentadas pelo PNCP.
  A consulta /contratacoes/proposta exige codigoModalidadeContratacao.
*/
const MODALIDADES = {
  1: "Leilão - Eletrônico",
  2: "Diálogo Competitivo",
  3: "Concurso",
  4: "Concorrência - Eletrônica",
  5: "Concorrência - Presencial",
  6: "Pregão - Eletrônico",
  7: "Pregão - Presencial",
  8: "Dispensa de Licitação",
  9: "Inexigibilidade",
  10: "Manifestação de Interesse",
  11: "Pré-qualificação",
  12: "Credenciamento",
  13: "Leilão - Presencial"
};

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return null;
}

async function fetchJson(url, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "ST-Processos-PNCP/1.1"
      },
      signal: controller.signal
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(`PNCP HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new Error("O PNCP retornou uma resposta que não é JSON válido.");
    }
  } finally {
    clearTimeout(timer);
  }
}

function getContent(data) {
  if (Array.isArray(data)) return data;

  return (
    data?.data ||
    data?.content ||
    data?.resultados ||
    data?.items ||
    []
  );
}

function getTotalPages(data) {
  return Number(
    data?.totalPaginas ??
    data?.totalPages ??
    data?.numeroPaginas ??
    data?.paginas ??
    1
  ) || 1;
}

function normalizeProcesso(item, modalidadeCodigo) {
  const org = item?.orgaoEntidade || item?.orgao || item?.entidade || {};
  const unidade = item?.unidadeOrgao || item?.unidadeAdministrativa || {};

  const uf =
    pick(unidade, "ufSigla") ||
    pick(org, "ufSigla") ||
    item?.uf ||
    "";

  const cnpj =
    pick(org, "cnpj", "cnpjOrgao") ||
    item?.cnpjOrgao ||
    item?.cnpj ||
    "";

  const ano = item?.anoCompra || item?.ano || "";
  const seq = item?.sequencialCompra || item?.sequencial || "";

  const controle =
    item?.numeroControlePNCP ||
    item?.numeroControlePncp ||
    "";

  const modalidade =
    item?.modalidadeNome ||
    item?.modalidade ||
    MODALIDADES[modalidadeCodigo] ||
    "Não informada";

  const situacaoCompraId = Number(
    item?.situacaoCompraId ?? item?.situacaoId ?? 0
  ) || 0;

  const situacaoCompraNome =
    item?.situacaoCompraNome ||
    item?.situacaoNome ||
    "";

  return {
    controlePncp: controle,
    numero:
      item?.numeroCompra ||
      item?.numeroEdital ||
      item?.numeroProcesso ||
      controle ||
      "Processo PNCP",
    orgao:
      org?.razaoSocial ||
      org?.razaoSocialOrgao ||
      org?.nome ||
      item?.razaoSocial ||
      "Órgão não informado",
    uf: String(uf || "").toUpperCase(),
    modalidade,
    modalidadeCodigo,
    situacaoCompraId,
    situacaoCompraNome,
    objeto:
      item?.objetoCompra ||
      item?.objeto ||
      item?.descricao ||
      "Objeto não informado",
    complemento: item?.informacaoComplementar || item?.informacaoComplementarObjeto || "",
    encerramento:
      item?.dataEncerramentoProposta ||
      item?.dataEncerramento ||
      item?.dataFimRecebimentoPropostas ||
      null,
    abertura:
      item?.dataAberturaProposta ||
      item?.dataAbertura ||
      null,
    valor:
      item?.valorTotalEstimado ??
      item?.valorEstimado ??
      null,
    link: controle
      ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`
      : "https://pncp.gov.br/app/editais"
  };
}

function isDivulgadaNoPncp(processo) {
  // No PNCP, o código 1 corresponde exatamente a "Divulgada no PNCP".
  // Mantemos também a comparação pelo nome para tolerar respostas de versões diferentes da API.
  return (
    processo.situacaoCompraId === SITUACAO_DIVULGADA_ID ||
    normalizeText(processo.situacaoCompraNome) === normalizeText(SITUACAO_DIVULGADA_NOME)
  );
}

function matches(processo, keyword) {
  if (!keyword) return true;

  const terms = normalizeText(keyword)
    .split(/\s+/)
    .filter(Boolean);

  const haystack = normalizeText([
    processo.objeto,
    processo.complemento,
    processo.numero,
    processo.orgao,
    processo.modalidade
  ].join(" "));

  return terms.every(term => haystack.includes(term));
}

function dateBRYYYYMMDD(daysAhead = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

async function consultaModalidade(codigo, dataFinal, uf, keyword) {
  const resultados = [];
  const maxPages = 100;

  for (let pagina = 1; pagina <= maxPages; pagina++) {
    const params = new URLSearchParams({
      dataFinal,
      codigoModalidadeContratacao: String(codigo),
      pagina: String(pagina),
      tamanhoPagina: "50"
    });

    if (uf) params.set("uf", uf);

    const url = `${PNCP}?${params.toString()}`;
    const data = await fetchJson(url);
    const content = getContent(data);

    if (!content.length) break;

    for (const raw of content) {
      const processo = normalizeProcesso(raw, codigo);

      // A API já limita propostas abertas, mas mantemos uma segunda
      // validação para impedir que registros encerrados apareçam.
      const encerramento = processo.encerramento
        ? new Date(processo.encerramento)
        : null;

      const aberto =
        !encerramento ||
        Number.isNaN(encerramento.getTime()) ||
        encerramento.getTime() >= Date.now();

      if (
        isDivulgadaNoPncp(processo) &&
        aberto &&
        (!uf || processo.uf === uf) &&
        matches(processo, keyword)
      ) {
        resultados.push(processo);
      }
    }

    const totalPages = getTotalPages(data);

    if (pagina >= totalPages || pagina >= maxPages) break;
  }

  return resultados;
}

app.get("/api/processos", async (req, res) => {
  const uf = String(req.query.uf || "").trim().toUpperCase();
  const keyword = String(req.query.q || "").trim();

  if (keyword.length < 2) {
    return res.status(400).json({
      error: "Informe pelo menos 2 caracteres do material ou serviço."
    });
  }

  const key = `${uf || "TODAS"}|${normalizeText(keyword)}`;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return res.json({
      ...cached.data,
      cache: true
    });
  }

  // O endpoint /contratacoes/proposta consulta contratações cujo período
  // de recebimento está aberto na data informada. Para encontrar o que está
  // aberto AGORA, a dataFinal precisa ser HOJE.
  // Não usamos uma data futura: isso pode excluir editais que fecham antes
  // dessa data futura.
  const dataFinal = dateBRYYYYMMDD(0);

  const processos = [];
  const warnings = [];
  let chamadasOK = 0;
  let registrosRecebidos = 0;

  /*
    Não disparamos 13 chamadas simultaneamente porque a API do PNCP
    pode aplicar limitação de requisições. As modalidades são consultadas
    uma por uma.
  */
  for (const codigo of Object.keys(MODALIDADES).map(Number)) {
    try {
      const encontrados = await consultaModalidade(
        codigo,
        dataFinal,
        uf,
        keyword
      );

      chamadasOK += 1;
      registrosRecebidos += encontrados.length;
      processos.push(...encontrados);
    } catch (error) {
      warnings.push(
        `${MODALIDADES[codigo]}: ${error.name === "AbortError"
          ? "tempo limite excedido"
          : error.message}`
      );
    }
  }

  // Remove duplicados pelo número de controle PNCP.
  const unique = new Map();

  for (const processo of processos) {
    const id =
      processo.controlePncp ||
      `${processo.numero}|${processo.orgao}|${processo.encerramento}`;

    if (!unique.has(id)) unique.set(id, processo);
  }

  const final = [...unique.values()].sort((a, b) => {
    const da = new Date(a.encerramento || "2999-12-31").getTime();
    const db = new Date(b.encerramento || "2999-12-31").getTime();
    return da - db;
  });

  const data = {
    processos: final,
    warnings,
    consulta: {
      uf: uf || null,
      keyword,
      dataFinal,
      modalidadesConsultadas: Object.keys(MODALIDADES).length,
      chamadasOK,
      registrosFiltrados: registrosRecebidos,
      situacao: {
        id: SITUACAO_DIVULGADA_ID,
        nome: SITUACAO_DIVULGADA_NOME
      },
      periodoAteDias: 0,
      criterio: "Endpoint de propostas abertas na data de hoje + situacaoCompraId=1 (Divulgada no PNCP) + data de encerramento ainda futura"
    }
  };

  cache.set(key, {
    at: Date.now(),
    data
  });

  res.json(data);
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ST Processos",
    pncp: PNCP
  });
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ST Processos ativo na porta ${PORT}`);
});
