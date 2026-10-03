const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const PNCP =
  "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";

const CACHE_MS = 5 * 60 * 1000;
const MAX_PAGES = 30;
const PAGE_SIZE = 50;
const cache = new Map();

const MODALIDADES = {
  1: "Leilão - Eletrônico",
  2: "Diálogo Competitivo",
  3: "Concurso",
  4: "Concorrência - Eletrônica",
  5: "Concorrência - Presencial",
  6: "Pregão - Eletrônico",
  7: "Pregão - Presencial",
  8: "Dispensa",
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
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function dateBRYYYYMMDD(daysAhead = 365) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("");
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json, */*",
        "user-agent": "ST-Processos-PNCP/2.0"
      },
      signal: controller.signal
    });

    if (response.status === 204) {
      return { data: [], content: [] };
    }

    const body = await response.text();

    if (!response.ok) {
      throw new Error(`PNCP HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new Error("Resposta do PNCP não é JSON.");
    }
  } finally {
    clearTimeout(timer);
  }
}

function contentOf(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.content || data?.items || data?.resultados || [];
}

function totalPagesOf(data) {
  return Number(
    data?.totalPaginas ??
    data?.totalPages ??
    data?.numeroPaginas ??
    data?.paginas ??
    1
  ) || 1;
}

function normalizeProcesso(item, modalidadeCodigo = null) {
  const org = item?.orgaoEntidade || {};
  const unidade = item?.unidadeOrgao || {};

  const uf = String(
    pick(unidade, "ufSigla") ||
    pick(org, "ufSigla") ||
    item?.uf ||
    ""
  ).toUpperCase();

  const cnpj =
    pick(org, "cnpj") ||
    item?.cnpjOrgao ||
    item?.cnpj ||
    "";

  const ano = item?.anoCompra || item?.ano || "";
  const seq = item?.sequencialCompra || item?.sequencial || "";
  const controle = item?.numeroControlePNCP || "";

  const modalidadeCodigoReal =
    item?.modalidadeId ||
    item?.codigoModalidadeContratacao ||
    modalidadeCodigo;

  const modalidade =
    item?.modalidadeNome ||
    MODALIDADES[modalidadeCodigoReal] ||
    "Não informada";

  return {
    controlePncp: controle,
    numero:
      item?.numeroCompra ||
      item?.numeroEdital ||
      item?.processo ||
      item?.numeroProcesso ||
      controle ||
      "Processo PNCP",
    orgao:
      org?.razaoSocial ||
      org?.razaosocial ||
      org?.nome ||
      item?.razaoSocial ||
      "Órgão não informado",
    uf,
    modalidade,
    modalidadeCodigo: modalidadeCodigoReal,
    objeto:
      item?.objetoCompra ||
      item?.objeto ||
      item?.descricao ||
      "",
    complemento:
      item?.informacaoComplementar ||
      item?.informacaoComplementarObjeto ||
      "",
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

function keywordMatch(processo, keyword) {
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

function isOpen(processo) {
  if (!processo.encerramento) return true;

  const date = new Date(processo.encerramento);
  if (Number.isNaN(date.getTime())) return true;

  return date.getTime() >= Date.now();
}

async function queryEndpoint({ uf, keyword, modalidade = null }) {
  const results = [];

  /*
    IMPORTANTE:
    dataFinal não deve ser "hoje". O endpoint usa essa data para delimitar
    o período de recebimento. Para encontrar propostas que continuam abertas
    nos próximos dias/meses, usamos uma janela de 365 dias.
  */
  const dataFinal = dateBRYYYYMMDD(365);

  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const params = new URLSearchParams({
      dataFinal,
      pagina: String(pagina),
      tamanhoPagina: String(PAGE_SIZE)
    });

    if (uf) params.set("uf", uf);

    if (modalidade !== null) {
      params.set(
        "codigoModalidadeContratacao",
        String(modalidade)
      );
    }

    const url = `${PNCP}?${params.toString()}`;
    const payload = await fetchJson(url);
    const items = contentOf(payload);

    if (!items.length) break;

    for (const item of items) {
      const processo = normalizeProcesso(item, modalidade);

      if (
        (!uf || processo.uf === uf) &&
        isOpen(processo) &&
        keywordMatch(processo, keyword)
      ) {
        results.push(processo);
      }
    }

    const totalPages = totalPagesOf(payload);

    if (pagina >= totalPages || items.length < PAGE_SIZE) break;
  }

  return results;
}

async function queryWithFallback(uf, keyword) {
  const warnings = [];

  /*
    Primeiro tenta a forma mais nova/documentada: modalidade opcional.
    Isso evita 13 chamadas quando a API aceitar a consulta geral.
  */
  try {
    const results = await queryEndpoint({
      uf,
      keyword,
      modalidade: null
    });

    return {
      results,
      warnings,
      strategy: "consulta-geral"
    };
  } catch (error) {
    warnings.push(`Consulta geral: ${error.message}`);
  }

  /*
    Compatibilidade com versões da API que exigem modalidade.
    Consulta as modalidades em paralelo em pequenos lotes.
  */
  const results = [];

  for (let start = 0; start < Object.keys(MODALIDADES).length; start += 3) {
    const batch = Object.keys(MODALIDADES)
      .slice(start, start + 3)
      .map(Number);

    const settled = await Promise.allSettled(
      batch.map(modalidade =>
        queryEndpoint({
          uf,
          keyword,
          modalidade
        })
      )
    );

    settled.forEach((result, index) => {
      const modalidade = batch[index];

      if (result.status === "fulfilled") {
        results.push(...result.value);
      } else {
        warnings.push(
          `${MODALIDADES[modalidade]}: ${result.reason?.message || "erro"}`
        );
      }
    });
  }

  return {
    results,
    warnings,
    strategy: "por-modalidade"
  };
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

  try {
    const response = await queryWithFallback(uf, keyword);

    const unique = new Map();

    for (const processo of response.results) {
      const id =
        processo.controlePncp ||
        `${processo.numero}|${processo.orgao}|${processo.encerramento}`;

      if (!unique.has(id)) {
        unique.set(id, processo);
      }
    }

    const processos = [...unique.values()].sort((a, b) => {
      const da = new Date(a.encerramento || "2999-12-31").getTime();
      const db = new Date(b.encerramento || "2999-12-31").getTime();
      return da - db;
    });

    const data = {
      processos,
      warnings: response.warnings,
      consulta: {
        uf: uf || null,
        keyword,
        dataFinal: dateBRYYYYMMDD(365),
        strategy: response.strategy,
        fonte: PNCP
      }
    };

    cache.set(key, {
      at: Date.now(),
      data
    });

    return res.json(data);
  } catch (error) {
    return res.status(502).json({
      error:
        `Não foi possível consultar o PNCP agora. ${error.message}`,
      processos: []
    });
  }
});

app.get("/api/health", async (req, res) => {
  res.json({
    ok: true,
    service: "ST Processos",
    pncp: PNCP,
    message: "Servidor online. A busca consulta diretamente a API pública do PNCP."
  });
});

app.get("/api/pncp-url", (req, res) => {
  const uf = String(req.query.uf || "").trim().toUpperCase();
  const q = String(req.query.q || "").trim();

  const params = new URLSearchParams({
    q,
    status: "recebendo_proposta",
    pagina: "1"
  });

  if (uf) params.set("ufs", uf);

  res.json({
    url: `https://pncp.gov.br/app/editais?${params.toString()}`
  });
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ST Processos ativo na porta ${PORT}`);
});
