let processos = [];

const $ = selector => document.querySelector(selector);

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.style.background = error ? "#8f1d1d" : "#18212f";
  element.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => element.classList.remove("show"), 3600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data.error || "Não foi possível consultar o servidor.");
  return data;
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function fmtDateOnly(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("pt-BR");
}

function fmtMoney(value) {
  if (value === null || value === undefined || value === "") return "Não informado";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function yesNo(value) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return "Não informado";
}

function render() {
  const query = String($("#resultFilter").value || "").toLowerCase().trim();
  const rows = processos.filter(process => {
    const searchable = [
      process.numero, process.orgao, process.uf, process.municipio,
      process.modalidade, process.objeto, process.controlePncp,
      process.processo, process.unidade
    ].join(" ").toLowerCase();
    return searchable.includes(query);
  });

  $("#processTable tbody").innerHTML = rows.length
    ? rows.map((process, index) => `
      <tr>
        <td class="result-id">
          <strong>${esc(process.numero || "—")}</strong>
          <small>${esc(process.controlePncp || "")}</small>
          <small>${esc(process.processo ? `Processo: ${process.processo}` : "")}</small>
        </td>
        <td class="result-org">
          <strong>${esc(process.orgao || "—")}</strong>
          <small>${esc([process.unidade, process.municipio, process.uf].filter(Boolean).join(" • ") || "Local não informado")}</small>
        </td>
        <td class="result-mode">
          <strong>${esc(process.modalidade || "—")}</strong>
          <small>${esc(process.modoDisputaNome ? `Disputa: ${process.modoDisputaNome}` : "")}</small>
          <small>${process.srp === null || process.srp === undefined ? "" : `SRP: ${yesNo(process.srp)}`}</small>
        </td>
        <td class="result-object">${esc(process.objeto || "—")}</td>
        <td class="result-value">
          <strong class="js-value">${esc(fmtMoney(process.valor))}</strong>
          <small class="js-enrich-status">${process.enriquecimento?.status === "ok" ? "Extraído do edital" : "Consultando edital..."}</small>
        </td>
        <td class="result-dates">
          <small><b>Início da recepção:</b> <span class="js-abertura">${esc(fmtDate(process.abertura))}</span></small>
          <small><b>Fim da recepção:</b> <span class="js-encerramento">${esc(fmtDate(process.encerramento))}</span></small>
        </td>
        <td class="result-status">
          <span class="status-pill">${esc(process.situacaoCompraNome || "Divulgada no PNCP")}</span>
          <small>${esc(process.fonte ? `Plataforma: ${process.fonte}` : "")}</small>
        </td>
        <td class="result-actions">
          <button class="details-btn" data-index="${index}">Detalhes</button>
          <a class="secondary-link" href="${esc(process.link || "#")}" target="_blank" rel="noopener">PNCP ↗</a>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="8" class="empty">Nenhum processo corresponde aos filtros informados.</td></tr>`;

  $("#processTable tbody").querySelectorAll(".details-btn").forEach(button => {
    button.addEventListener("click", () => openDetails(Number(button.dataset.index), rows));
  });
}

async function enrichVisibleResults() {
  const snapshot = processos.slice();
  const queue = snapshot.map((process, index) => ({ process, index }));
  let cursor = 0;
  const workers = Math.min(6, queue.length);

  async function worker() {
    while (true) {
      const item = queue[cursor++];
      if (!item) return;
      try {
        const data = await api(`/api/processos/enriquecer?id=${encodeURIComponent(item.process.controlePncp)}`);
        const enriched = data.processo || {};
        const target = processos.find(p => p.controlePncp === enriched.controlePncp);
        if (!target) continue;

        // O endpoint de enriquecimento parte apenas do identificador PNCP.
        // Portanto ele pode devolver os metadados como "Não informado" enquanto
        // ainda não conseguiu recuperá-los. Nunca substitua dados bons da busca
        // por esses placeholders. Só aplicamos valores efetivamente encontrados.
        const placeholders = new Set([
          "", "—", "Não informado", "Órgão não informado",
          "Objeto não informado", "Não informada", null, undefined
        ]);
        const canReplace = value => !placeholders.has(value);

        for (const [key, value] of Object.entries(enriched)) {
          if (key === "enriquecimento") {
            target.enriquecimento = value;
            continue;
          }
          if (canReplace(value)) target[key] = value;
        }

        // Campos numéricos nulos não apagam um valor já encontrado.
        if (enriched.valor !== null && enriched.valor !== undefined && enriched.valor !== "") {
          target.valor = enriched.valor;
        }
        if (enriched.abertura) target.abertura = enriched.abertura;
        if (enriched.encerramento) target.encerramento = enriched.encerramento;
        render();
      } catch (error) {
        const target = processos.find(p => p.controlePncp === item.process.controlePncp);
        if (target) {
          target.enriquecimento = { status: "erro", erro: error.message };
          render();
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));
}

function renderDiagnostics(data) {
  const box = $("#diagnostics");
  if (!box) return;
  const c = data?.consulta || {};
  $("#diagResponse").textContent = data?.warnings?.length ? "COM AVISOS/ERROS" : "OK";
  $("#diagRaw").textContent = Number(c.rawTotal ?? 0).toLocaleString("pt-BR");
  $("#diagDivulgada").textContent = Number(c.divulgadaTotal ?? 0).toLocaleString("pt-BR");
  $("#diagAbertos").textContent = Number(c.abertosTotal ?? 0).toLocaleString("pt-BR");
  $("#diagFound").textContent = Number(c.primary?.encontrados ?? c.encontradosTotal ?? 0).toLocaleString("pt-BR");
  $("#diagAiBefore").textContent = Number(c.candidatosAntesIA ?? c.ai?.candidatosAntes ?? 0).toLocaleString("pt-BR");
  $("#diagAiAfter").textContent = Number(c.candidatosDepoisIA ?? c.ai?.mantidos ?? 0).toLocaleString("pt-BR");
  $("#diagAiRemoved").textContent = Number(c.ai?.removidos ?? 0).toLocaleString("pt-BR");
  $("#diagAiStatus").textContent = c.ai?.status === "ok" ? `ATIVO (${c.ai.model || "OpenAI"})` : (c.ai?.status || "—");
  $("#diagTime").textContent = `${Math.round((c.tempoMs || c.durationMs || 0) / 1000)}s`;
  $("#officialSearch").href = data?.portalUrl || "https://pncp.gov.br/app/editais";
  $("#diagDetails").textContent = JSON.stringify(c, null, 2);
  box.classList.remove("hidden");
}

function detailField(label, value, extraClass = "") {
  if (value === null || value === undefined || value === "") value = "Não informado";
  return `<div class="detail-field ${extraClass}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function renderDetails(data, base) {
  const c = data.contratacao || {};
  const org = c.orgaoEntidade || {};
  const unidade = c.unidadeOrgao || {};
  const sub = c.orgaoSubRogado || {};
  const subUnit = c.unidadeSubRogada || {};
  const amparo = c.amparoLegal || {};
  const docs = data.documentos || [];
  const itens = data.itens || [];
  const historico = data.historico || [];
  const fontes = data.fontesOrcamentarias;
  const contratos = data.contratos || [];
  const atas = data.atas || [];

  $("#detailsTitle").textContent = c.numeroCompra ? `Edital / Processo ${c.numeroCompra}` : (base.numero || "Detalhes da contratação");
  $("#detailsSubtitle").textContent = base.controlePncp || "Contratação PNCP";

  $("#detailsContent").innerHTML = `
    <div class="detail-hero">
      <div>
        <div class="eyebrow">CONTRATAÇÃO PNCP</div>
        <h3>${esc(c.objetoCompra || base.objeto || "Objeto não informado")}</h3>
      </div>
      <div class="detail-hero-actions">
        <a class="primary" href="${esc(base.link || "#")}" target="_blank" rel="noopener">Abrir no PNCP ↗</a>
      </div>
    </div>

    <section class="detail-section">
      <h4>Informações principais</h4>
      <div class="detail-grid">
        ${detailField("ID contratação PNCP", c.numeroControlePNCP || base.controlePncp)}
        ${detailField("Número da contratação", c.numeroCompra || base.numero)}
        ${detailField("Ano", c.anoCompra)}
        ${detailField("Processo", c.processo || base.processo)}
        ${detailField("Instrumento convocatório", c.tipoInstrumentoConvocatorioNome)}
        ${detailField("Modalidade", c.modalidadeNome || base.modalidade)}
        ${detailField("Modo de disputa", c.modoDisputaNome || base.modoDisputaNome)}
        ${detailField("Situação", c.situacaoCompraNome || base.situacaoCompraNome || "Divulgada no PNCP")}
        ${detailField("SRP", yesNo(c.srp))}
        ${detailField("Valor estimado", fmtMoney(c.valorTotalEstimado ?? base.valor))}
        ${detailField("Valor homologado", fmtMoney(c.valorTotalHomologado ?? base.valorHomologado))}
        ${detailField("Orçamento sigiloso", c.orcamentoSigilosoDescricao || "Não informado")}
        ${detailField("Abertura das propostas", fmtDate(c.dataAberturaProposta || base.abertura))}
        ${detailField("Encerramento das propostas", fmtDate(c.dataEncerramentoProposta || base.encerramento))}
        ${detailField("Publicação no PNCP", fmtDateOnly(c.dataPublicacaoPncp || base.publicacao))}
        ${detailField("Inclusão no PNCP", fmtDateOnly(c.dataInclusao || base.dataInclusao))}
        ${detailField("Última atualização", fmtDate(c.dataAtualizacao || base.dataAtualizacao))}
        ${detailField("Fonte / plataforma", base.fonte || "Não informado")}
      </div>
    </section>

    <section class="detail-section">
      <h4>Órgão, unidade e localização</h4>
      <div class="detail-grid">
        ${detailField("CNPJ do órgão", org.cnpj)}
        ${detailField("Órgão / entidade", org.razaoSocial)}
        ${detailField("Poder", org.poderId)}
        ${detailField("Esfera", org.esferaId)}
        ${detailField("Código da unidade", unidade.codigoUnidade)}
        ${detailField("Unidade", unidade.nomeUnidade)}
        ${detailField("Município", unidade.municipioNome)}
        ${detailField("UF", unidade.ufSigla)}
        ${detailField("Código IBGE", unidade.municipioId)}
      </div>
      ${sub.razaoSocial || sub.cnpj ? `<div class="sub-block"><b>Órgão/entidade sub-rogado</b><br>${esc(sub.razaoSocial || "")}${sub.cnpj ? ` • CNPJ ${esc(sub.cnpj)}` : ""}</div>` : ""}
      ${subUnit.nomeUnidade || subUnit.municipioNome ? `<div class="sub-block"><b>Unidade sub-rogada</b><br>${esc(subUnit.nomeUnidade || "")}${subUnit.municipioNome ? ` • ${esc(subUnit.municipioNome)}/${esc(subUnit.ufSigla || "")}` : ""}</div>` : ""}
    </section>

    <section class="detail-section">
      <h4>Objeto e fundamentação</h4>
      <div class="long-field"><span>Objeto</span><p>${esc(c.objetoCompra || base.objeto || "Não informado")}</p></div>
      <div class="long-field"><span>Informação complementar</span><p>${esc(c.informacaoComplementar || base.complemento || "Não informado")}</p></div>
      <div class="detail-grid">
        ${detailField("Amparo legal", c.amparoLegalNome || amparo.nome || base.amparoLegalNome)}
        ${detailField("Descrição do amparo", c.amparoLegalDescricao || amparo.descricao || base.amparoLegalDescricao)}
      </div>
    </section>

    <section class="detail-section">
      <div class="section-title-row"><h4>Documentos do edital</h4><span class="section-count">${docs.length}</span></div>
      ${docs.length ? `<div class="documents-list">${docs.map(doc => `
        <div class="document-row">
          <div class="document-icon">PDF</div>
          <div class="document-info">
            <strong>${esc(doc.titulo || "Documento")}</strong>
            <small>${esc(doc.tipoDocumentoNome || "Documento")} • Publicado em ${esc(fmtDateOnly(doc.dataPublicacaoPncp))}</small>
          </div>
          <div class="document-actions">
            ${doc.sequencialDocumento ? `<a class="secondary-link" href="/api/processos/documento?id=${encodeURIComponent(base.controlePncp)}&documento=${encodeURIComponent(doc.sequencialDocumento)}">Baixar</a>` : ""}
            ${doc.url ? `<a class="secondary-link" href="${esc(doc.url)}" target="_blank" rel="noopener">Abrir</a>` : ""}
          </div>
        </div>
      `).join("")}</div>` : `<div class="empty-detail">Nenhum documento foi disponibilizado pelo PNCP para esta contratação.</div>`}
    </section>

    <section class="detail-section">
      <div class="section-title-row"><h4>Itens da contratação</h4><span class="section-count">${itens.length}</span></div>
      ${itens.length ? `<div class="items-table-wrap"><table class="items-table"><thead><tr><th>Item</th><th>Descrição</th><th>Qtd.</th><th>Unidade</th><th>Valor unit.</th><th>Valor total</th><th>Categoria</th><th>Situação</th></tr></thead><tbody>${itens.map(item => `
        <tr>
          <td>${esc(item.numeroItem ?? "—")}</td>
          <td><strong>${esc(item.descricao || "—")}</strong>${item.informacaoComplementar ? `<small>${esc(item.informacaoComplementar)}</small>` : ""}</td>
          <td>${esc(item.quantidade ?? "—")}</td>
          <td>${esc(item.unidadeMedida || "—")}</td>
          <td>${esc(fmtMoney(item.valorUnitarioEstimado))}</td>
          <td>${esc(fmtMoney(item.valorTotal))}</td>
          <td>${esc(item.itemCategoriaNome || item.materialOuServicoNome || "—")}</td>
          <td>${esc(item.situacaoCompraItemNome || "—")}</td>
        </tr>
      `).join("")}</tbody></table></div>` : `<div class="empty-detail">Nenhum item foi retornado pela API do PNCP.</div>`}
    </section>

    <section class="detail-section">
      <h4>Fontes orçamentárias</h4>
      <div class="raw-box">${esc(JSON.stringify(fontes || { informacao: "Não informado" }, null, 2))}</div>
    </section>

    ${atas.length ? `<section class="detail-section"><div class="section-title-row"><h4>Atas relacionadas</h4><span class="section-count">${atas.length}</span></div><div class="related-list">${atas.map(ata => `<pre>${esc(JSON.stringify(ata, null, 2))}</pre>`).join("")}</div></section>` : ""}
    ${contratos.length ? `<section class="detail-section"><div class="section-title-row"><h4>Contratos / empenhos relacionados</h4><span class="section-count">${contratos.length}</span></div><div class="related-list">${contratos.map(item => `<pre>${esc(JSON.stringify(item, null, 2))}</pre>`).join("")}</div></section>` : ""}

    <section class="detail-section">
      <div class="section-title-row"><h4>Histórico da contratação</h4><span class="section-count">${historico.length}</span></div>
      ${historico.length ? `<div class="history-list">${historico.map(event => `
        <div class="history-row"><div class="history-date">${esc(fmtDate(event.logManutencaoDataInclusao || event.dataInclusao))}</div><div><strong>${esc(event.tipoLogManutencaoNome || "Evento")}</strong><small>${esc(event.categoriaLogManutencaoNome || "")}${event.documentoTitulo ? ` • ${esc(event.documentoTitulo)}` : ""}${event.justificativa ? ` • ${esc(event.justificativa)}` : ""}</small></div></div>
      `).join("")}</div>` : `<div class="empty-detail">Nenhum evento de histórico retornado.</div>`}
    </section>

    ${data.erros?.length ? `<section class="detail-section warning-section"><h4>Itens que o PNCP não retornou</h4><ul>${data.erros.map(error => `<li>${esc(error)}</li>`).join("")}</ul></section>` : ""}

    <details class="raw-details"><summary>Dados completos retornados pela API</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>
  `;
}

async function openDetails(index, sourceRows = processos) {
  const process = sourceRows[index];
  if (!process) return;
  $("#detailsModal").classList.remove("hidden");
  $("#detailsContent").innerHTML = `<div class="loading-details"><div class="spinner"></div><strong>Consultando todos os dados desta contratação no PNCP...</strong><span>Buscando dados, itens, documentos e histórico.</span></div>`;
  try {
    const data = await api(`/api/processos/detalhes?id=${encodeURIComponent(process.controlePncp)}`);
    renderDetails(data, process);
  } catch (error) {
    $("#detailsContent").innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  }
}

function closeDetails() {
  $("#detailsModal").classList.add("hidden");
}

async function search(event) {
  event?.preventDefault();
  const uf = $("#uf").value;
  const keyword = $("#keyword").value.trim();
  if (keyword.length < 2) return toast("Informe pelo menos 2 caracteres do material ou serviço.", true);

  $("#searchBtn").disabled = true;
  $("#loading").classList.remove("hidden");
  $("#results").classList.add("hidden");
  $("#stats").classList.add("hidden");
  $("#diagnostics").classList.add("hidden");
  $("#notice").classList.add("hidden");
  $("#progress").textContent = "Consultando a base oficial do PNCP e localizando os editais. Os dados de valor e recepção serão extraídos dos documentos em segundo plano...";

  try {
    const data = await api(`/api/processos?uf=${encodeURIComponent(uf)}&q=${encodeURIComponent(keyword)}`);
    processos = data.processos || [];
    renderDiagnostics(data);
    $("#statTotal").textContent = processos.length;
    $("#statUf").textContent = uf || "Todas";
    $("#statAbertos").textContent = processos.length;
    $("#resultHint").textContent = `${processos.length} processo(s) encontrado(s) para “${keyword}”`;
    $("#stats").classList.remove("hidden");
    $("#results").classList.remove("hidden");
    render();
    // Não bloqueia a exibição dos resultados: cada edital é lido em segundo plano.
    enrichVisibleResults();

    if (data.warnings?.length) {
      $("#notice").textContent = "A pesquisa foi concluída, mas houve avisos: " + data.warnings.join(" | ");
      $("#notice").classList.remove("hidden");
    }
    if (!processos.length) {
      $("#notice").textContent = "Nenhum processo aberto foi localizado com esse material/serviço e UF. Tente um termo mais amplo.";
      $("#notice").classList.remove("hidden");
    }
  } catch (error) {
    toast(error.message, true);
    $("#notice").textContent = error.message;
    $("#notice").classList.remove("hidden");
  } finally {
    $("#loading").classList.add("hidden");
    $("#searchBtn").disabled = false;
  }
}

$("#searchForm").addEventListener("submit", search);
$("#resultFilter").addEventListener("input", render);
$("#refreshBtn").addEventListener("click", () => { if ($("#keyword").value.trim()) search({ preventDefault() {} }); });
$("#closeDetails").addEventListener("click", closeDetails);
$("#detailsModal").addEventListener("click", event => { if (event.target === $("#detailsModal")) closeDetails(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#detailsModal").classList.contains("hidden")) closeDetails(); });


// Barra horizontal fixa sincronizada com a tabela de resultados
(function setupHorizontalScrollProxy() {
  const init = () => {
    const wrap = document.querySelector("#results .table-wrap");
    const proxy = document.getElementById("horizontalScrollProxy");
    const inner = document.getElementById("horizontalScrollProxyInner");
    const table = document.getElementById("processTable");
    if (!wrap || !proxy || !inner || !table) return;
    let syncing = false;
    const update = () => {
      const needed = wrap.scrollWidth > wrap.clientWidth + 1 &&
        !document.getElementById("results").classList.contains("hidden");
      proxy.classList.toggle("active", needed);
      document.body.classList.toggle("has-scroll-proxy", needed);
      inner.style.width = `${wrap.scrollWidth}px`;
      if (needed && !syncing) {
        syncing = true; proxy.scrollLeft = wrap.scrollLeft; syncing = false;
      }
    };
    wrap.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true; proxy.scrollLeft = wrap.scrollLeft; syncing = false;
    }, { passive: true });
    proxy.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true; wrap.scrollLeft = proxy.scrollLeft; syncing = false;
    }, { passive: true });
    new ResizeObserver(update).observe(wrap);
    new MutationObserver(update).observe(document.getElementById("results"), {
      attributes: true, attributeFilter: ["class"]
    });
    update();
    // A tabela pode ser renderizada/atualizada depois da pesquisa.
    const tbody = table.querySelector("tbody");
    if (tbody) new MutationObserver(update).observe(tbody, { childList: true, subtree: true });
    window.addEventListener("resize", update);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
