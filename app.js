const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
let config={modalidades:[],modosDisputa:[],ufs:[]};
let state={rows:[],page:1,total:0,pages:1,limit:50,filters:null,loading:false};

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function fmtMoney(v){const n=Number(v);return Number.isFinite(n)&&n>0?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Não informado';}
function fmtDate(v){if(!v)return'—';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
function fmtDateOnly(v){if(!v)return'—';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return d.toLocaleDateString('pt-BR');}
function fmtCnpj(v){const d=String(v||'').replace(/\D/g,'');return d.length===14?d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5'):(v||'—');}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2800);}
function setLoading(on,text='Consultando PNCP e Compras.gov.br em paralelo, consolidando e eliminando duplicidades.'){state.loading=on;$('#loading').classList.toggle('hidden',!on);$('#loadingText').textContent=text;$('#searchBtn').disabled=on;}
function ymd(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function apiQuery(){
  const p=new URLSearchParams();
  const add=(k,v)=>{if(v!==undefined&&v!==null&&String(v)!=='')p.set(k,String(v));};
  add('status',$('#status').value);add('keyword',$('#keyword').value.trim());add('uf',$('#uf').value);add('municipio',$('#municipio').value.trim());add('modalidade',$('#modalidade').value);add('modoDisputa',$('#modoDisputa').value);
  const a=$('#dataInicial').value.replaceAll('-',''),b=$('#dataFinal').value.replaceAll('-','');add('dataInicial',a);add('dataFinal',b);add('limite',$('#limite').value);add('pagina',state.page);return p.toString();
}
async function api(url){const r=await fetch(url);let d=null;try{d=await r.json()}catch{}if(!r.ok)throw new Error(d?.error||`Erro HTTP ${r.status}`);return d;}
function populateConfig(){
  $('#uf').insertAdjacentHTML('beforeend',config.ufs.map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join(''));
  $('#modalidade').insertAdjacentHTML('beforeend',config.modalidades.map(m=>`<option value="${m.id}">${esc(m.nome)}</option>`).join(''));
  $('#modoDisputa').insertAdjacentHTML('beforeend',config.modosDisputa.map(m=>`<option value="${m.id}">${esc(m.nome)}</option>`).join(''));
}
function setDefaultDates(){const end=new Date(),start=new Date(end.getTime()-29*86400000);$('#dataFinal').value=ymd(end);$('#dataInicial').value=ymd(start);}
function isOpen(r){const d=new Date(r.dataEncerramentoProposta);return !Number.isNaN(d.getTime())&&d.getTime()>=Date.now();}
function sourceBadge(v){return String(v||'').split(' + ').map(x=>`<span class="source-tag">${esc(x)}</span>`).join(' ');}
function renderRows(){
  const q=String($('#resultFilter').value||'').trim().toLowerCase();
  const rows=state.rows.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q));
  $('#resultBody').innerHTML=rows.length?rows.map((r,i)=>{
    const open=isOpen(r);const city=[r.unidadeOrgao?.municipioNome,r.unidadeOrgao?.ufSigla].filter(Boolean).join('/');
    const proc=r.numeroCompra||r.numeroControlePNCP||r.processo||'Contratação';
    return `<tr>
      <td><div class="process-title">${esc(proc)}</div><div class="cell-muted">Processo: ${esc(r.processo||'Não informado')}</div><div class="process-id">${esc(r.numeroControlePNCP||'ID PNCP não informado')}</div></td>
      <td><div class="process-title">${esc(r.orgaoEntidade?.razaoSocial||'Órgão não informado')}</div><div class="cell-muted">CNPJ: ${esc(fmtCnpj(r.orgaoEntidade?.cnpj))}</div><div class="cell-muted">${esc(r.unidadeOrgao?.nomeUnidade||'Unidade não informada')}</div></td>
      <td>${esc(city||'Não informado')}<div class="cell-muted">IBGE: ${esc(r.unidadeOrgao?.municipioId||'—')}</div></td>
      <td><span class="badge">${esc(r.modalidadeNome||'Não informada')}</span></td>
      <td>${esc(r.modoDisputaNome||'Não informado')}</td>
      <td><span class="badge ${open?'open':'closed'}">${open?'Aberto':'Encerrado / sem prazo'}</span><div class="cell-muted">Início: ${esc(fmtDate(r.dataAberturaProposta))}</div><div class="cell-muted">Fim: ${esc(fmtDate(r.dataEncerramentoProposta))}</div></td>
      <td>${esc(fmtMoney(r.valorTotalEstimado))}</td><td>${sourceBadge(r._fonte)}</td>
      <td><button class="primary detail-btn" data-i="${i}">Detalhes</button></td>
    </tr>`;
  }).join(''):'<tr><td colspan="9" class="empty">Nenhum processo encontrado com os filtros informados.</td></tr>';
  $$('.detail-btn').forEach(b=>b.addEventListener('click',()=>openDetail(rows[Number(b.dataset.i)])));
}
function renderStats(){const open=state.rows.filter(isOpen).length;$('#statTotal').textContent=state.total.toLocaleString('pt-BR');$('#statAbertos').textContent=open.toLocaleString('pt-BR');$('#statFontes').textContent=new Set(state.rows.flatMap(r=>String(r._fonte||'').split(' + '))).size;$('#statModalidades').textContent=new Set(state.rows.map(r=>r.modalidadeNome).filter(Boolean)).size;$('#stats').classList.remove('hidden');}
function renderPagination(){ $('#pageInfo').textContent=`Página ${state.page} de ${state.pages}`;$('#prevBtn').disabled=state.page<=1;$('#nextBtn').disabled=state.page>=state.pages; }
async function search(e){e?.preventDefault();if(state.loading)return;state.page=1;await fetchResults();}
async function fetchResults(){
  setLoading(true);$('#notice').classList.add('hidden');$('#results').classList.add('hidden');$('#detail').classList.add('hidden');
  try{const d=await api('/api/processos?'+apiQuery());state.rows=d.resultado||[];state.total=Number(d.totalRegistros||0);state.pages=Number(d.paginas||1);state.limit=Number(d.tamanhoPagina||50);state.filters=d.filtros;renderRows();renderStats();renderPagination();$('#resultHint').textContent=`${state.total.toLocaleString('pt-BR')} resultado(s) consolidados • página ${state.page}`;$('#results').classList.remove('hidden');if(d.avisos?.length){$('#notice').textContent='Algumas consultas auxiliares retornaram avisos: '+d.avisos.join(' | ');$('#notice').className='notice warn';$('#notice').classList.remove('hidden');}}catch(e){$('#notice').textContent=e.message;$('#notice').className='notice error';$('#notice').classList.remove('hidden');}finally{setLoading(false);}}
function detailPill(label,value){return `<div class="pill"><small>${esc(label)}</small><strong>${esc(value??'—')}</strong></div>`;}
function link(url,label){return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:'';}
function renderItems(items){if(!items?.length)return'<div class="notice">A fonte consultada não retornou itens nesta contratação. O restante do edital continua disponível acima.</div>';return `<div class="table-wrap"><table class="items-table"><thead><tr><th>Item</th><th>Descrição</th><th>Material/serviço</th><th>Unidade</th><th>Qtd.</th><th>Valor unitário</th><th>Valor total</th><th>Critério</th><th>Situação</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.numeroItem??x.numeroItemPncp??x.numeroItemCompra??'—')}</td><td><strong>${esc(x.descricaoResumida||x.descricao||x.descricaodetalhada||x.descricaoDetalhada||'—')}</strong><div class="cell-muted">${esc(x.descricaodetalhada||x.descricaoDetalhada||'')}</div></td><td>${esc(x.materialOuServicoNome||x.materialOuServico||'—')}</td><td>${esc(x.unidadeMedida||x.nomeUnidadeMedida||'—')}</td><td>${esc(x.quantidade??'—')}</td><td>${esc(fmtMoney(x.valorUnitarioEstimado??x.valorUnitario))}</td><td>${esc(fmtMoney(x.valorTotal))}</td><td>${esc(x.criterioJulgamentoNome||'—')}</td><td>${esc(x.situacaoCompraItemNome||'—')}</td></tr>`).join('')}</tbody></table></div>`;}
function renderDocs(docs){if(!docs?.length)return'<div class="notice">Nenhum arquivo foi retornado pela API para esta contratação.</div>';return `<div class="doc-list">${docs.map(d=>`<div class="doc"><div><div class="doc-title">${esc(d.titulo||d.nome||'Documento')}</div><small>${esc(d.tipoDocumentoNome||'Documento')} • publicado em ${esc(fmtDateOnly(d.dataPublicacaoPncp))}</small></div>${d.url?`<a class="primary" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Abrir arquivo</a>`:''}</div>`).join('')}</div>`;}
function renderHistory(h){if(!h?.length)return'<div class="notice">Histórico não retornado pela fonte.</div>';return `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Operação</th><th>Categoria</th><th>Documento</th><th>Justificativa</th></tr></thead><tbody>${h.map(x=>`<tr><td>${esc(fmtDate(x.logManutencaoDataInclusao||x.dataInclusao))}</td><td>${esc(x.tipoLogManutencaoNome||x.tipoLogManutencao||'—')}</td><td>${esc(x.categoriaLogManutencaoNome||x.categoriaLogManutencao||'—')}</td><td>${esc(x.documentoTitulo||x.documentoTipo||'—')}</td><td>${esc(x.justificativa||'—')}</td></tr>`).join('')}</tbody></table></div>`;}
async function openDetail(row){
  const id=row?._ids;if(!id?.cnpj||!id.ano||!id.seq){toast('Este resultado não possui identificadores suficientes para abrir o detalhe.');return;}
  const box=$('#detail');box.classList.remove('hidden');box.innerHTML='<div class="loading-title"><span class="spinner"></span><strong>Carregando edital, arquivos, itens e histórico...</strong></div>';box.scrollIntoView({behavior:'smooth',block:'start'});
  try{const d=await api(`/api/processos/${encodeURIComponent(id.cnpj)}/${id.ano}/${id.seq}`);const x=d.detail;box.innerHTML=`
    <div class="detail-top"><div class="detail-title"><div class="eyebrow">DETALHES DA CONTRATAÇÃO</div><h2>${esc(x.objetoCompra||x.numeroCompra||'Contratação pública')}</h2><div class="process-id">${esc(x.numeroControlePNCP||'ID PNCP não informado')}</div></div><div class="detail-actions">${x.urlPncp?`<a class="primary" href="${esc(x.urlPncp)}" target="_blank" rel="noopener noreferrer">Visualizar no PNCP</a>`:''}${x.linkSistemaOrigem?`<a class="ghost" href="${esc(x.linkSistemaOrigem)}" target="_blank" rel="noopener noreferrer">Sistema de origem</a>`:''}<button class="ghost" id="closeDetail">Fechar</button></div></div>
    <div class="detail-grid">
      ${detailPill('Número da contratação',x.numeroCompra)}${detailPill('Processo',x.processo)}${detailPill('Modalidade',x.modalidadeNome)}${detailPill('Instrumento convocatório',x.tipoInstrumentoConvocatorioNome)}
      ${detailPill('Modo de disputa',x.modoDisputaNome)}${detailPill('Situação',x.situacaoCompraNome)}${detailPill('Sistema de registro de preços',x.srp?'Sim':'Não')}${detailPill('Orçamento sigiloso',x.orcamentoSigilosoDescricao)}
      ${detailPill('Valor total estimado',fmtMoney(x.valorTotalEstimado))}${detailPill('Valor homologado',fmtMoney(x.valorTotalHomologado))}${detailPill('Abertura das propostas',fmtDate(x.dataAberturaProposta))}${detailPill('Encerramento das propostas',fmtDate(x.dataEncerramentoProposta))}
      ${detailPill('Publicação no PNCP',fmtDateOnly(x.dataPublicacaoPncp))}${detailPill('Última atualização',fmtDate(x.dataAtualizacaoPncp))}${detailPill('Poder',x.orgaoEntidade?.poderId)}${detailPill('Esfera',x.orgaoEntidade?.esferaId)}
    </div>
    <div class="detail-section"><h3>Órgão e unidade</h3><div class="detail-grid">${detailPill('Órgão',x.orgaoEntidade?.razaoSocial)}${detailPill('CNPJ',fmtCnpj(x.orgaoEntidade?.cnpj))}${detailPill('Unidade',x.unidadeOrgao?.nomeUnidade)}${detailPill('Código da unidade',x.unidadeOrgao?.codigoUnidade)}${detailPill('Município',x.unidadeOrgao?.municipioNome)}${detailPill('UF',x.unidadeOrgao?.ufSigla)}${detailPill('Código IBGE',x.unidadeOrgao?.municipioId)}${detailPill('Usuário/sistema de envio',x.usuarioNome)}</div></div>
    <div class="detail-section"><h3>Objeto</h3><div class="longtext">${esc(x.objetoCompra||'Não informado')}</div>${x.informacaoComplementar?`<h3 style="margin-top:15px">Informações complementares</h3><div class="longtext">${esc(x.informacaoComplementar)}</div>`:''}</div>
    <div class="detail-section"><h3>Base legal e condições</h3><div class="detail-grid">${detailPill('Amparo legal',x.amparoLegal?.amparoLegalNome||x.amparoLegalNome)}${detailPill('Descrição do amparo',x.amparoLegal?.amparoLegalDescricao||x.amparoLegalDescricao)}${detailPill('Emenda parlamentar',x.emendaParlamentar?'Sim':'Não')}${detailPill('Justificativa presencial',x.justificativaPresencial||'Não se aplica')}</div></div>
    <div class="detail-section"><h3>Links oficiais</h3><div class="link-list">${link(x.urlPncp,'Visualizar a contratação no PNCP')}${link(x.linkSistemaOrigem,'Acessar o sistema de origem / recebimento de propostas')}${link(x.linkProcessoEletronico,'Acessar o processo eletrônico')}</div></div>
    <div class="detail-section"><h3>Arquivos e documentos do edital</h3>${renderDocs(d.documentos)}</div>
    <div class="detail-section"><h3>Itens da contratação (${d.itens?.length||0})</h3>${renderItems(d.itens)}</div>
    <div class="detail-section"><h3>Histórico da contratação (${d.historico?.length||0})</h3>${renderHistory(d.historico)}</div>
    ${d.errors?.length?`<div class="notice warn">Alguns complementos não puderam ser carregados: ${esc(d.errors.join(' | '))}</div>`:''}<div class="detail-section"><details><summary><strong>Dados técnicos completos retornados pelas fontes</strong></summary><pre style="margin-top:12px;background:#0f1722;color:#dbe7f7;padding:14px;border-radius:10px;overflow:auto;max-height:520px;font-size:11px">${esc(JSON.stringify({contratacao:d.detail,documentos:d.documentos,itens:d.itens,historico:d.historico},null,2))}</pre></details></div>`;
    $('#closeDetail').addEventListener('click',()=>box.classList.add('hidden'));
  }catch(e){box.innerHTML=`<div class="notice error">${esc(e.message)}</div><button class="ghost" id="closeDetail">Fechar</button>`;$('#closeDetail').addEventListener('click',()=>box.classList.add('hidden'));}
}
function clearFilters(){ $('#keyword').value='';$('#uf').value='';$('#municipio').value='';$('#modalidade').value='';$('#modoDisputa').value='';$('#status').value='publicacao';setDefaultDates();$('#results').classList.add('hidden');$('#stats').classList.add('hidden');$('#detail').classList.add('hidden');$('#notice').classList.add('hidden');state={...state,rows:[],total:0,page:1,pages:1}; }
async function init(){
  try{config=await api('/api/config');populateConfig();setDefaultDates();const syncFilters=()=>{
    const hasUf=Boolean($('#uf').value);
    $('#municipio').disabled=!hasUf;
    $('#municipio').title=hasUf?'Opcional: informe a cidade para restringir a busca.':'Selecione uma UF primeiro';
    if(!hasUf) $('#municipio').value='';
    $('#dataInicial').disabled=false; $('#dataInicial').title='Período de publicação da contratação';
  };
  $('#uf').addEventListener('change',syncFilters);
  $('#status').addEventListener('change',syncFilters);
  syncFilters();}catch(e){toast('Não foi possível carregar os filtros: '+e.message);}
  $('#searchForm').addEventListener('submit',search);$('#clearBtn').addEventListener('click',clearFilters);$('#refreshBtn').addEventListener('click',()=>{if(state.filters)fetchResults();else toast('Defina os filtros e faça uma pesquisa.');});$('#resultFilter').addEventListener('input',renderRows);
  $('#prevBtn').addEventListener('click',()=>{if(state.page>1){state.page--;fetchResults()}});$('#nextBtn').addEventListener('click',()=>{if(state.page<state.pages){state.page++;fetchResults()}});
}
init();
