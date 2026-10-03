const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PNCP = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

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
  13: "Leilão - Presencial",
  14: "Procedimento de Manifestação de Interesse"
};

function cacheKey(uf, q) {
  return `${uf || "ALL"}|${q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;
}

async function fetchJson(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`PNCP HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj?.[key] != null) return obj[key];
  }
  return null;
}

function normalize(item) {
  const org = item.orgaoEntidade || item.orgao || item.entidade || {};
  const unidade = item.unidadeOrgao || item.unidadeAdministrativa || {};

  const uf =
    pick(unidade, "ufSigla") ||
    pick(org, "ufSigla") ||
    item.uf ||
    "";

  const cnpj =
    pick(org, "cnpj", "cnpjOrgao") ||
    item.cnpj ||
    "";

  const ano = item.anoCompra || item.ano || "";
  const seq = item.sequencialCompra || item.sequencial || "";
  const controle =
    item.numeroControlePNCP ||
    item.numeroControlePncp ||
    item.controlePncp ||
    "";

  return {
    controlePncp: controle,
    numero:
      pick(item, "numeroCompra", "numeroEdital", "numeroProcesso") ||
      controle ||
      "Processo PNCP",
    orgao:
      pick(org, "razaoSocial", "razaoSocialOrgao", "nome") ||
      pick(item, "razaoSocial") ||
      "Órgão não informado",
    uf: String(uf || "").toUpperCase(),
    modalidade:
      MODALIDADES[item.codigoModalidadeContratacao] ||
      item.modalidadeNome ||
      item.modalidade ||
      "Não informada",
    objeto:
      pick(item, "objetoCompra", "objeto", "descricao") ||
      "Objeto não informado",
    encerramento:
      pick(
        item,
        "dataEncerramentoProposta",
        "dataEncerramento",
        "dataFimRecebimentoPropostas"
      ),
    abertura:
      pick(item, "dataAberturaProposta", "dataAbertura"),
    valor:
      item.valorTotalEstimado ??
      item.valorEstimado ??
      null,
    link: controle
      ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`
      : "https://pncp.gov.br/app/editais"
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matches(processo, query) {
  return normalizeText(processo.objeto).includes(normalizeText(query));
}

app.get("/api/processos", async (req, res) => {
  const uf = String(req.query.uf || "").trim().toUpperCase();
  const q = String(req.query.q || "").trim();

  if (q.length < 2) {
    return res.status(400).json({
      error: "Informe o material ou serviço que deseja pesquisar."
    });
  }

  const key = cacheKey(uf, q);
  const cached = cache.get(key);

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return res.json({ ...cached.data, cache: true });
  }

  const hoje = new Date();
  const dataFinal = hoje.toISOString().slice(0, 10).replace(/-/g, "");

  const params = new URLSearchParams({
    dataFinal,
    pagina: "1",
    tamanhoPagina: "50"
  });

  if (uf) params.set("uf", uf);

  const encontrados = [];
  const warnings = [];

  try {
    let page = 1;
    let totalPages = 1;

    while (page <= Math.min(totalPages, 20)) {
      params.set("pagina", String(page));

      const data = await fetchJson(`${PNCP}?${params.toString()}`);
      const content =
        data.data ||
        data.content ||
        data.resultados ||
        [];

      totalPages = Number(
        data.totalPaginas ||
        data.totalPages ||
        data.numeroPaginas ||
        1
      ) || 1;

      for (const raw of content) {
        const processo = normalize(raw);

        if (
          (!uf || processo.uf === uf) &&
          matches(processo, q)
        ) {
          encontrados.push(processo);
        }
      }

      if (!content.length || page >= totalPages) break;
      page++;
    }
  } catch (error) {
    warnings.push(
      error.name === "AbortError"
        ? "O PNCP demorou além do limite de resposta."
        : `Falha temporária ao consultar o PNCP: ${error.message}`
    );
  }

  encontrados.sort(
    (a, b) =>
      new Date(a.encerramento || 0) -
      new Date(b.encerramento || 0)
  );

  const data = {
    processos: encontrados,
    warnings
  };

  cache.set(key, { at: Date.now(), data });
  res.json(data);
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ST Processos ativo na porta ${PORT}`);
});
