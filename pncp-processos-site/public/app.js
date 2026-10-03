let processos = [];

const $ = selector => document.querySelector(selector);

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.style.background = error ? "#8f1d1d" : "#18212f";
  element.classList.add("show");

  clearTimeout(window.__toast);
  window.__toast = setTimeout(
    () => element.classList.remove("show"),
    3200
  );
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_) {}

  if (!response.ok) {
    throw new Error(
      data.error || "Não foi possível consultar o servidor."
    );
  }

  return data;
}

function fmtDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function render() {
  const query = String($("#resultFilter").value || "")
    .toLowerCase()
    .trim();

  const rows = processos.filter(process => {
    const searchable = [
      process.numero,
      process.orgao,
      process.uf,
      process.modalidade,
      process.objeto,
      process.controlePncp
    ].join(" ").toLowerCase();

    return searchable.includes(query);
  });

  $("#processTable tbody").innerHTML = rows.length
    ? rows.map(process => `
      <tr>
        <td>
          <strong>${esc(process.numero || "—")}</strong>
          <br>
          <small>${esc(process.controlePncp || "")}</small>
        </td>
        <td style="white-space:normal;min-width:210px">
          ${esc(process.orgao || "—")}
        </td>
        <td>${esc(process.uf || "—")}</td>
        <td>${esc(process.modalidade || "—")}</td>
        <td style="white-space:normal;min-width:360px">
          ${esc(process.objeto || "—")}
        </td>
        <td>${esc(fmtDate(process.encerramento))}</td>
        <td>
          <a
            class="primary"
            style="display:inline-block;text-decoration:none"
            href="${esc(process.link || "#")}"
            target="_blank"
            rel="noopener"
          >
            Abrir PNCP
          </a>
        </td>
      </tr>
    `).join("")
    : `
      <tr>
        <td colspan="7" class="empty">
          Nenhum processo corresponde aos filtros informados.
        </td>
      </tr>
    `;
}

async function search(event) {
  event?.preventDefault();

  const uf = $("#uf").value;
  const keyword = $("#keyword").value.trim();

  if (keyword.length < 2) {
    return toast(
      "Informe pelo menos 2 caracteres do material ou serviço.",
      true
    );
  }

  $("#searchBtn").disabled = true;
  $("#loading").classList.remove("hidden");
  $("#results").classList.add("hidden");
  $("#stats").classList.add("hidden");
  $("#notice").classList.add("hidden");

  $("#progress").textContent =
    "Consultando a base oficial do PNCP. Isso pode levar alguns segundos...";

  try {
    const data = await api(
      `/api/processos?uf=${encodeURIComponent(uf)}&q=${encodeURIComponent(keyword)}`
    );

    processos = data.processos || [];

    $("#statTotal").textContent = processos.length;
    $("#statUf").textContent = uf || "Todas";
    $("#statAbertos").textContent = processos.length;

    $("#resultHint").textContent =
      `${processos.length} processo(s) encontrado(s) para “${keyword}”`;

    $("#stats").classList.remove("hidden");
    $("#results").classList.remove("hidden");

    render();

    if (data.warnings?.length) {
      $("#notice").textContent =
        "A pesquisa foi concluída com avisos do PNCP: " +
        data.warnings.join(" | ");

      $("#notice").classList.remove("hidden");
    }

    if (!processos.length) {
      $("#notice").textContent =
        "Nenhum processo aberto foi localizado com esse material/serviço e UF. " +
        "Tente um termo mais amplo.";

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

$("#refreshBtn").addEventListener("click", () => {
  if ($("#keyword").value.trim()) {
    search({ preventDefault() {} });
  }
});
