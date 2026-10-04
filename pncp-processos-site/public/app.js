let processos = [];
let currentUser = null;
let authPollTimer = null;

const $ = selector => document.querySelector(selector);

function showLogin(message = "") {
  currentUser = null;
  document.body.classList.add("app-locked");
  const screen = $("#loginScreen");
  if (screen) screen.classList.remove("hidden");
  const box = $("#loginMessage");
  if (box) { box.textContent = message; box.classList.toggle("hidden", !message); }
  const password = $("#loginPassword");
  if (password) password.value = "";
}

function hideLogin(user) {
  currentUser = user;
  document.body.classList.remove("app-locked");
  $("#loginScreen")?.classList.add("hidden");
  $("#loginMessage")?.classList.add("hidden");
  const badge = $("#currentUserBadge");
  if (badge) {
    badge.innerHTML = `<strong>${esc(user?.name || user?.username || "Usuário")}</strong>${esc(user?.role === "admin" ? "Administrador" : user?.username || "")}`;
    badge.classList.remove("hidden");
  }
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", user?.role !== "admin"));
  if (user?.role !== "admin" && ["credenciais","manutencao"].includes(window.currentView)) switchView("buscar");
}

function switchView(view) {
  const allowed = view === "buscar" || (currentUser?.role === "admin" && ["credenciais","manutencao"].includes(view));
  if (!allowed) view = "buscar";
  window.currentView = view;
  document.querySelectorAll(".view").forEach(el => el.classList.add("hidden"));
  const target = document.getElementById(`${view}View`);
  if (target) target.classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  const title = { buscar: "Buscar processos", credenciais: "Administrar credenciais", manutencao: "Configurações / manutenção" }[view] || "STZ Licita Master - Painel";
  const h1 = document.querySelector(".topbar h1"); if (h1) h1.textContent = title;
  if (view === "credenciais") loadCredentials();
  if (view === "manutencao") loadMaintenancePanel();
}

async function handleAuthFailure(errorData) {
  const message = errorData?.error || "Sua sessão não está mais ativa. Faça login novamente.";
  if (errorData?.code === "MAINTENANCE") showLogin(message);
  else showLogin(message);
}


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
  if (!response.ok) {
    if (response.status === 401 || response.status === 423) {
      await handleAuthFailure(data);
    }
    const detail = data.error || data.message || `HTTP ${response.status}`;
    const error = new Error(`Falha ao consultar os detalhes: ${detail}`);
    error.status = response.status; error.code = data.code;
    throw error;
  }
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
        <td class="result-dates">
          <span class="lazy-date-hint">Clique em <strong>Detalhes</strong> para visualizar as datas de recepção de propostas.</span>
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
    : `<tr><td colspan="7" class="empty">Nenhum processo corresponde aos filtros informados.</td></tr>`;

  $("#processTable tbody").querySelectorAll(".details-btn").forEach(button => {
    button.addEventListener("click", () => openDetails(Number(button.dataset.index), rows));
  });
}

function setupDiagnosticsToggle(){
  const toggle = $("#diagnosticsToggle");
  const content = $("#diagnosticsContent");
  if(!toggle || !content || toggle.dataset.bound === "1") return;
  toggle.dataset.bound = "1";
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    const next = !expanded;
    toggle.setAttribute("aria-expanded", String(next));
    content.hidden = !next;
    const hint = toggle.querySelector(".diagnostics-toggle-hint");
    if(hint) hint.textContent = next ? "Clique para ocultar os dados da consulta" : "Clique para exibir os dados da consulta";
    const card = $("#diagnostics");
    if(card) card.classList.toggle("diagnostics-collapsed", !next);
  });
}

function renderDiagnostics(data) {
  const box = $("#diagnostics");
  if (!box) return;
  // Informações de diagnóstico são internas e ficam disponíveis somente para administradores.
  if (currentUser?.role !== "admin") {
    box.classList.add("hidden");
    return;
  }
  setupDiagnosticsToggle();
  const c = data?.consulta || {};
  $("#diagResponse").textContent = data?.warnings?.length ? "COM AVISOS/ERROS" : "OK";
  $("#diagRaw").textContent = Number(c.rawTotal ?? 0).toLocaleString("pt-BR");
  $("#diagDivulgada").textContent = Number(c.divulgadaTotal ?? 0).toLocaleString("pt-BR");
  $("#diagAbertos").textContent = Number(c.abertosTotal ?? 0).toLocaleString("pt-BR");
  $("#diagFound").textContent = Number(c.primary?.encontrados ?? c.encontradosTotal ?? 0).toLocaleString("pt-BR");
  $("#diagAiBefore").textContent = Number(c.candidatosAntesIA ?? c.ai?.candidatosAntes ?? 0).toLocaleString("pt-BR");
  $("#diagAiAfter").textContent = Number(c.candidatosDepoisIA ?? c.ai?.mantidos ?? 0).toLocaleString("pt-BR");
  $("#diagAiRemoved").textContent = Number(c.ai?.removidos ?? 0).toLocaleString("pt-BR");
  $("#diagAiStatus").textContent = c.ai?.status === "ok" ? `ATIVO (${c.ai.model || "Gemini"})` : (c.ai?.status || "—");
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
          <div class="document-icon">DOC</div>
          <div class="document-info">
            <strong>${esc(doc.titulo || "Documento")}</strong>
            <small>${esc(doc.tipoDocumentoNome || "Documento")} • Publicado em ${esc(fmtDateOnly(doc.dataPublicacaoPncp))}</small>
          </div>
          <div class="document-actions">
            ${doc.sequencialDocumento ? `<a class="secondary-link" href="/api/processos/documento?id=${encodeURIComponent(base.controlePncp)}&documento=${encodeURIComponent(doc.sequencialDocumento)}&visualizar=1" target="_blank" rel="noopener">Visualizar</a>` : ""}
            ${doc.sequencialDocumento ? `<a class="secondary-link download-document" href="/api/processos/documento?id=${encodeURIComponent(base.controlePncp)}&documento=${encodeURIComponent(doc.sequencialDocumento)}">Baixar</a>` : ""}
            ${doc.url ? `<a class="secondary-link" href="${esc(doc.url)}" target="_blank" rel="noopener">Original</a>` : ""}
          </div>
        </div>
      `).join("")}</div>` : `<div class="empty-detail">Documentos mais pesados ou alto volume de anexos podem sobrecarregar o sistema. AGUARDE, POIS OS DOCUMENTOS IRÃO APARECER.</div>`}
    </section>

    <section class="detail-section">
      <div class="section-title-row"><h4>Itens da contratação</h4><span class="section-count">${itens.length}</span></div>
      ${data.extrasPendentes ? `<div class="detail-loading-inline">Carregando itens da contratação…</div>` : itens.length ? `<div class="items-table-wrap"><table class="items-table"><thead><tr><th>Item</th><th>Descrição</th><th>Qtd.</th><th>Unidade</th><th>Valor unit.</th><th>Valor total</th><th>Categoria</th><th>Situação</th></tr></thead><tbody>${itens.map(item => `
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
      <div class="raw-box">${data.extrasPendentes ? "Carregando…" : esc(JSON.stringify(fontes || { informacao: "Não informado" }, null, 2))}</div>
    </section>

    ${data.extrasPendentes ? `<section class="detail-section"><h4>Atas e contratos relacionados</h4><div class="detail-loading-inline">Carregando atas e contratos relacionados…</div></section>` : `${atas.length ? `<section class="detail-section"><div class="section-title-row"><h4>Atas relacionadas</h4><span class="section-count">${atas.length}</span></div><div class="related-list">${atas.map(ata => `<pre>${esc(JSON.stringify(ata, null, 2))}</pre>`).join("")}</div></section>` : ""}${contratos.length ? `<section class="detail-section"><div class="section-title-row"><h4>Contratos / empenhos relacionados</h4><span class="section-count">${contratos.length}</span></div><div class="related-list">${contratos.map(item => `<pre>${esc(JSON.stringify(item, null, 2))}</pre>`).join("")}</div></section>` : ""}`}

    <section class="detail-section">
      <div class="section-title-row"><h4>Histórico da contratação</h4><span class="section-count">${historico.length}</span></div>
      ${data.extrasPendentes ? `<div class="detail-loading-inline">Carregando histórico da contratação…</div>` : historico.length ? `<div class="history-list">${historico.map(event => `
        <div class="history-row"><div class="history-date">${esc(fmtDate(event.logManutencaoDataInclusao || event.dataInclusao))}</div><div><strong>${esc(event.tipoLogManutencaoNome || "Evento")}</strong><small>${esc(event.categoriaLogManutencaoNome || "")}${event.documentoTitulo ? ` • ${esc(event.documentoTitulo)}` : ""}${event.justificativa ? ` • ${esc(event.justificativa)}` : ""}</small></div></div>
      `).join("")}</div>` : `<div class="empty-detail">Nenhum evento de histórico retornado.</div>`}
    </section>

    ${currentUser?.role === "admin" && data.erros?.length ? `<section class="detail-section warning-section"><h4>Itens que o PNCP não retornou</h4><ul>${data.erros.map(error => `<li>${esc(error)}</li>`).join("")}</ul></section>` : ""}

    ${currentUser?.role === "admin" ? `<details class="raw-details"><summary>Dados completos retornados pela API</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>` : ""}
  `;
}

async function openDetails(index, sourceRows = processos) {
  const process = sourceRows[index];
  if (!process) return;
  $("#detailsModal").classList.remove("hidden");
  $("#detailsContent").innerHTML = `<div class="loading-details"><div class="spinner"></div><strong>Carregando informações da contratação...</strong><span>Primeiro carregamos os dados principais e os documentos. Itens, histórico e vínculos são carregados em seguida.</span></div>`;
  try {
    const detalheFallback = encodeURIComponent(JSON.stringify(process));
    const data = await api(`/api/processos/detalhes?id=${encodeURIComponent(process.controlePncp)}&fallback=${detalheFallback}`);
    renderDetails(data, process);

    // Segunda etapa, somente para o edital que o usuário abriu. Isso evita
    // consultar PDFs/datas/itens/histórico de dezenas de resultados durante a pesquisa.
    let currentData = data;
    if (data.extrasPendentes) {
      try {
        const extrasFallback = encodeURIComponent(JSON.stringify(process));
        const extras = await api(`/api/processos/detalhes-extras?id=${encodeURIComponent(process.controlePncp)}&fallback=${extrasFallback}`);
        currentData = {
          ...data,
          ...extras,
          itens: Array.isArray(extras.itens) && extras.itens.length ? extras.itens : (data.itens || []),
          documentos: Array.isArray(extras.documentos) && extras.documentos.length ? extras.documentos : (data.documentos || []),
          extrasPendentes: false
        };
        renderDetails(currentData, process);
      } catch (extraError) {
        currentData = { ...data, extrasPendentes: false, erros: [...(data.erros || []), `Dados complementares: ${extraError.message}`] };
        renderDetails(currentData, process);
      }
    }

    // Documentos são uma etapa independente: se a listagem de arquivos falhar,
    // isso não derruba os itens, datas ou informações principais.
    try {
      const docsFallback = encodeURIComponent(JSON.stringify(process));
      const docsData = await api(`/api/processos/detalhes-documentos?id=${encodeURIComponent(process.controlePncp)}&fallback=${docsFallback}`);
      if (Array.isArray(docsData.documentos) && docsData.documentos.length) {
        currentData = { ...currentData, documentos: docsData.documentos };
        renderDetails(currentData, process);
      } else if (docsData.erros?.length) {
        currentData = { ...currentData, erros: [...(currentData.erros || []), ...docsData.erros] };
        renderDetails(currentData, process);
      }
    } catch (docsError) {
      currentData = { ...currentData, erros: [...(currentData.erros || []), `Documentos: ${docsError.message}`] };
      renderDetails(currentData, process);
    }

    // Se o PNCP não trouxe as datas diretamente na contratação, agora que o
    // usuário abriu o processo lemos os documentos do edital. O resultado é
    // aplicado ao mesmo modal sem bloquear a primeira renderização.
    const c = currentData.contratacao || {};
    const hasStart = Boolean(c.dataAberturaProposta || c.dataInicioRecebimentoProposta || process.abertura);
    const hasEnd = Boolean(c.dataEncerramentoProposta || c.dataFimRecebimentoProposta || process.encerramento);
    if (!hasStart || !hasEnd) {
      try {
        const enriched = await api(`/api/processos/enriquecer?id=${encodeURIComponent(process.controlePncp)}`);
        if (enriched?.processo) {
          const mergedBase = { ...process, ...enriched.processo };
          renderDetails(currentData, mergedBase);
        }
      } catch (enrichError) {
        // A lista de documentos continua utilizável mesmo se a leitura do PDF
        // ou do Gemini estiver indisponível.
        const warning = `Leitura das datas no edital: ${enrichError.message}`;
        const errors = [...(currentData.erros || [])];
        if (!errors.includes(warning)) errors.push(warning);
        renderDetails({ ...currentData, erros: errors }, process);
      }
    }
  } catch (error) {
    // Mesmo se a API detalhada estiver indisponível, mostramos os dados que já
    // vieram da busca para não deixar o usuário diante de uma tela vazia.
    renderDetails({
      ok: false, id: process.controlePncp, contratacao: null, documentos: [],
      itens: [], historico: [], fontesOrcamentarias: null, contratos: [], atas: [],
      extrasPendentes: false, erros: [error.message]
    }, process);
  }
}

function closeDetails() {
  $("#detailsModal").classList.add("hidden");
}


async function login(event) {
  event?.preventDefault();
  const btn = $("#loginBtn");
  const message = $("#loginMessage");
  const cnpj = $("#loginCnpj").value.trim();
  const senha = $("#loginPassword").value;
  if (!cnpj || !senha) return;
  btn.disabled = true; btn.textContent = "Entrando...";
  message.classList.add("hidden");
  try {
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ cnpj, senha }) });
    hideLogin(data.user);
    switchView("buscar");
    startAuthPolling();
  } catch (error) {
    message.textContent = error.message.replace(/^Falha ao consultar os detalhes:\s*/, "");
    message.classList.remove("hidden");
  } finally { btn.disabled = false; btn.textContent = "Entrar"; }
}

async function logoutLocal(message = "") {
  try { await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } }); } catch (_) {}
  showLogin(message);
  switchView("buscar");
}

async function checkAuth() {
  try {
    const data = await api("/api/auth/me");
    hideLogin(data.user);
    startAuthPolling();
    return true;
  } catch (_) {
    showLogin();
    return false;
  }
}

function startAuthPolling() {
  clearInterval(authPollTimer);
  authPollTimer = setInterval(async () => {
    if (!currentUser) return;
    try {
      const data = await api("/api/auth/status");
      if (!data.user?.authenticated) await logoutLocal("Sua sessão foi encerrada. Faça login novamente.");
    } catch (error) {
      if (error.status === 401 || error.status === 423) showLogin(error.message.replace(/^Falha ao consultar os detalhes:\s*/, ""));
    }
  }, 3500);
}

function resetCredentialForm() {
  $("#credentialOriginalCnpj").value = "";
  $("#credentialCnpj").value = "";
  $("#credentialCompany").value = "";
  $("#credentialPassword").value = "";
  $("#credentialSaveBtn").textContent = "Cadastrar empresa";
  $("#credentialCancelBtn").classList.add("hidden");
}

async function loadCredentials() {
  if (currentUser?.role !== "admin") return;
  const body = $("#credentialsTableBody");
  try {
    const data = await api("/api/admin/credentials");
    body.innerHTML = data.users.length ? data.users.map(user => `
      <tr><td><strong>${esc(user.nomeEmpresa || "—")}</strong></td><td>${esc(user.cnpj)}</td><td><div class="table-actions"><button class="ghost credential-edit" data-cnpj="${esc(user.cnpj)}" type="button">Detalhes</button><button class="danger-btn credential-delete" data-cnpj="${esc(user.cnpj)}" type="button">Excluir</button></div></td></tr>
    `).join("") : `<tr><td colspan="3" class="empty">Nenhuma empresa cadastrada.</td></tr>`;
    body.querySelectorAll(".credential-edit").forEach(btn => btn.addEventListener("click", () => editCredential(btn.dataset.cnpj)));
    body.querySelectorAll(".credential-delete").forEach(btn => btn.addEventListener("click", () => deleteCredential(btn.dataset.cnpj)));
  } catch (error) { body.innerHTML = `<tr><td colspan="3" class="empty">${esc(error.message)}</td></tr>`; }
}

async function editCredential(cnpj) {
  try {
    const data = await api("/api/admin/credentials");
    const user = data.users.find(item => item.cnpj === cnpj);
    if (!user) return;

    $("#credentialDetailsOriginalCnpj").value = user.cnpj;
    $("#credentialDetailsCnpj").value = user.cnpj;
    $("#credentialDetailsCompany").value = user.nomeEmpresa || "";
    $("#credentialDetailsPasswordDisplay").value = "••••••••";
    $("#credentialDetailsNewPassword").value = "";
    $("#credentialNewPasswordWrap").classList.add("hidden");
    $("#credentialDetailsCancelPasswordBtn").classList.add("hidden");
    $("#credentialDetailsModal").classList.remove("hidden");
    $("#credentialDetailsCompany").focus();
  } catch (error) { toast(error.message, true); }
}

function closeCredentialDetails() {
  $("#credentialDetailsModal").classList.add("hidden");
  $("#credentialNewPasswordWrap").classList.add("hidden");
  $("#credentialDetailsCancelPasswordBtn").classList.add("hidden");
  $("#credentialDetailsNewPassword").value = "";
}

function enableCredentialPasswordChange() {
  $("#credentialNewPasswordWrap").classList.remove("hidden");
  $("#credentialDetailsCancelPasswordBtn").classList.remove("hidden");
  $("#credentialDetailsNewPassword").focus();
}

function cancelCredentialPasswordChange() {
  $("#credentialNewPasswordWrap").classList.add("hidden");
  $("#credentialDetailsCancelPasswordBtn").classList.add("hidden");
  $("#credentialDetailsNewPassword").value = "";
}

async function saveCredentialDetails(event) {
  event.preventDefault();
  const original = $("#credentialDetailsOriginalCnpj").value.trim();
  const payload = {
    cnpj: $("#credentialDetailsCnpj").value.trim(),
    nomeEmpresa: $("#credentialDetailsCompany").value.trim(),
    senha: $("#credentialDetailsNewPassword").value
  };
  const btn = $("#credentialDetailsSaveBtn");
  btn.disabled = true;
  try {
    await api(`/api/admin/credentials/${encodeURIComponent(original)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    toast("Credencial atualizada.");
    closeCredentialDetails();
    await loadCredentials();
  } catch (error) {
    toast(error.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function deleteCredentialFromDetails() {
  const cnpj = $("#credentialDetailsOriginalCnpj").value.trim();
  if (!cnpj) return;
  if (!confirm(`Excluir o acesso da empresa ${cnpj}? O usuário será deslogado e não poderá entrar novamente.`)) return;
  try {
    await api(`/api/admin/credentials/${encodeURIComponent(cnpj)}`, { method: "DELETE" });
    toast("Usuário excluído.");
    closeCredentialDetails();
    await loadCredentials();
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveCredential(event) {
  event.preventDefault();
  const original = $("#credentialOriginalCnpj").value.trim();
  const payload = { cnpj: $("#credentialCnpj").value.trim(), nomeEmpresa: $("#credentialCompany").value.trim(), senha: $("#credentialPassword").value };
  const btn = $("#credentialSaveBtn"); btn.disabled = true;
  try {
    await api(original ? `/api/admin/credentials/${encodeURIComponent(original)}` : "/api/admin/credentials", { method: original ? "PUT" : "POST", body: JSON.stringify(payload) });
    toast(original ? "Credencial atualizada." : "Empresa cadastrada.");
    resetCredentialForm(); await loadCredentials();
  } catch (error) { toast(error.message, true); }
  finally { btn.disabled = false; }
}

async function deleteCredential(cnpj) {
  if (!confirm(`Excluir o acesso da empresa ${cnpj}? O usuário será deslogado e não poderá entrar novamente.`)) return;
  try { await api(`/api/admin/credentials/${encodeURIComponent(cnpj)}`, { method: "DELETE" }); toast("Usuário excluído."); await loadCredentials(); }
  catch (error) { toast(error.message, true); }
}

async function loadMaintenancePanel() {
  if (currentUser?.role !== "admin") return;
  try {
    const settings = await api("/api/admin/settings"); $("#maintenanceToggle").checked = Boolean(settings.maintenance);
    await loadActiveUsers();
  } catch (error) { toast(error.message, true); }
}
async function loadActiveUsers() {
  const body = $("#activeUsersTableBody");
  try {
    const data = await api("/api/admin/active-users");
    body.innerHTML = data.users.length ? data.users.map(user => `
      <tr><td><strong>${esc(user.name || user.username)}</strong><small>${esc(user.role === "admin" ? "Administrador" : user.username)}</small></td><td>${esc(user.ip)}</td><td>${esc(fmtDate(user.since))}</td><td>${user.role === "admin" ? '<span class="muted">Administrador</span>' : `<button class="danger-btn active-logout" data-token="${esc(user.token)}" type="button">Deslogar</button>`}</td></tr>
    `).join("") : `<tr><td colspan="4" class="empty">Nenhum usuário conectado.</td></tr>`;
    body.querySelectorAll(".active-logout").forEach(btn => btn.addEventListener("click", async () => {
      try { await api(`/api/admin/active-users/${encodeURIComponent(btn.dataset.token)}/logout`, { method: "POST" }); toast("Usuário deslogado."); await loadActiveUsers(); }
      catch (error) { toast(error.message, true); }
    }));
  } catch (error) { body.innerHTML = `<tr><td colspan="4" class="empty">${esc(error.message)}</td></tr>`; }
}

async function toggleMaintenance() {
  const enabled = $("#maintenanceToggle").checked;
  try { await api("/api/admin/maintenance", { method: "POST", body: JSON.stringify({ enabled }) }); toast(enabled ? "Site fechado para manutenção. Usuários comuns foram deslogados." : "Site reaberto."); await loadActiveUsers(); }
  catch (error) { $("#maintenanceToggle").checked = !enabled; toast(error.message, true); }
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
  $("#progress").textContent = "Consultando os editais abertos na base oficial do PNCP. Os detalhes e as datas serão carregados somente quando você clicar em “Detalhes”.";

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

$("#loginForm").addEventListener("submit", login);
$("#logoutBtn").addEventListener("click", () => logoutLocal());
$("#credentialForm").addEventListener("submit", saveCredential);
$("#credentialCancelBtn").addEventListener("click", resetCredentialForm);
$("#refreshCredentialsBtn").addEventListener("click", loadCredentials);
$("#credentialDetailsForm").addEventListener("submit", saveCredentialDetails);
$("#closeCredentialDetails").addEventListener("click", closeCredentialDetails);
$("#credentialDetailsModal").addEventListener("click", event => { if (event.target === $("#credentialDetailsModal")) closeCredentialDetails(); });
$("#changeCredentialPasswordBtn").addEventListener("click", enableCredentialPasswordChange);
$("#credentialDetailsCancelPasswordBtn").addEventListener("click", cancelCredentialPasswordChange);
$("#credentialDetailsDeleteBtn").addEventListener("click", deleteCredentialFromDetails);
$("#maintenanceToggle").addEventListener("change", toggleMaintenance);
$("#refreshActiveUsersBtn").addEventListener("click", loadActiveUsers);
document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#searchForm").addEventListener("submit", search);
$("#resultFilter").addEventListener("input", render);
$("#refreshBtn").addEventListener("click", () => { if ($("#keyword").value.trim()) search({ preventDefault() {} }); });
$("#closeDetails").addEventListener("click", closeDetails);
$("#detailsModal").addEventListener("click", event => { if (event.target === $("#detailsModal")) closeDetails(); });
document.addEventListener("click", event => {
  const downloadLink = event.target.closest("a.download-document");
  if (!downloadLink) return;
  toast("Baixando documentos, por favor aguarde. Documentos que possuem mais folhas são mais pesados, demorando um pouco mais para efetuar o download.");
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!$("#detailsModal").classList.contains("hidden")) closeDetails();
  if (!$("#credentialDetailsModal").classList.contains("hidden")) closeCredentialDetails();
});


window.currentView = "buscar";
checkAuth();

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
