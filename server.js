const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PNCP_CONSULTA = 'https://pncp.gov.br/api/consulta';
const PNCP_API = 'https://pncp.gov.br/api/pncp';
const COMPRAS = 'https://dadosabertos.compras.gov.br';
const CACHE_TTL = 3 * 60 * 1000;
const DETAIL_TTL = 10 * 60 * 1000;
const cache = new Map();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

const UF = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
const MODALIDADES = [
  {id:1,nome:'Leilão - Eletrônico'}, {id:2,nome:'Diálogo Competitivo'}, {id:3,nome:'Concurso'},
  {id:4,nome:'Concorrência - Eletrônica'}, {id:5,nome:'Concorrência - Presencial'},
  {id:6,nome:'Pregão - Eletrônico'}, {id:7,nome:'Pregão - Presencial'}, {id:8,nome:'Dispensa de Licitação'},
  {id:9,nome:'Inexigibilidade'}, {id:10,nome:'Manifestação de Interesse'}, {id:11,nome:'Pré-qualificação'},
  {id:12,nome:'Credenciamento'}, {id:13,nome:'Leilão - Presencial'}
];
const MODALIDADE_BY_ID = new Map(MODALIDADES.map(x=>[String(x.id),x.nome]));
const MODOS = [{id:1,nome:'Aberto'},{id:2,nome:'Fechado'},{id:3,nome:'Aberto-Fechado'},{id:4,nome:'Dispensa com disputa'},{id:5,nome:'Não se aplica'},{id:6,nome:'Fechado-Aberto'}];
const MODO_BY_ID = new Map(MODOS.map(x=>[String(x.id),x.nome]));

function cleanDigits(v){return String(v||'').replace(/\D/g,'');}
function normalizeText(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function parseDate(v){ const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
function fmtYYYYMMDD(d){ const x=new Date(d); return `${x.getFullYear()}${String(x.getMonth()+1).padStart(2,'0')}${String(x.getDate()).padStart(2,'0')}`; }
function isoDateOnly(v){ const d=parseDate(v); return d ? d.toISOString().slice(0,10) : null; }
function clampInt(v, min, max, fallback){ const n=Number(v); return Number.isFinite(n) ? Math.max(min,Math.min(max,Math.trunc(n))) : fallback; }
function cacheGet(key){ const x=cache.get(key); if(!x || x.exp< Date.now()){cache.delete(key);return null;} return x.value; }
function cacheSet(key,value,ttl=CACHE_TTL){cache.set(key,{value,exp:Date.now()+ttl});return value;}
async function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

async function fetchJson(url, options={}){
  const key='GET '+url;
  const hit=cacheGet(key); if(hit!==null) return hit;
  let last;
  const retries=options.retries ?? 3;
  for(let i=0;i<retries;i++){
    try{
      const r=await fetch(url,{
        headers:{accept:'application/json','user-agent':'ST-Processos/1.1'},
        signal:AbortSignal.timeout(options.timeout||25000)
      });
      const text=await r.text();
      if(!r.ok){
        last=new Error(`HTTP ${r.status} em ${url}`);
        if([429,500,502,503,504].includes(r.status) && i<retries-1){
          const retryAfter=Number(r.headers.get('retry-after'));
          const wait=Number.isFinite(retryAfter)&&retryAfter>0 ? retryAfter*1000 : Math.min(8000,900*Math.pow(2,i));
          await sleep(wait);
          continue;
        }
        throw last;
      }
      const data=text?JSON.parse(text):null;
      return cacheSet(key,data,options.ttl||CACHE_TTL);
    }catch(e){
      last=e;
      if(i<retries-1){
        await sleep(Math.min(6000,700*Math.pow(2,i)));
      }
    }
  }
  throw last;
}

function buildUrl(base, route, params){ const u=new URL(base+route); for(const [k,v] of Object.entries(params||{})){if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));} return u.toString(); }
function resultArray(data){ return Array.isArray(data?.resultado)?data.resultado:Array.isArray(data)?data:[]; }
function pageMeta(data){ return {totalRegistros:Number(data?.totalRegistros||0),totalPaginas:Number(data?.totalPaginas||0),paginasRestantes:Number(data?.paginasRestantes||0)}; }
function keyOf(r){return r.numeroControlePNCP || r.idCompra || `${r.orgaoEntidade?.cnpj||r.orgaoEntidadeCnpj||r.cnpj||''}|${r.anoCompra||r.anoCompraPncp||r.ano||''}|${r.sequencialCompra||r.sequencialCompraPncp||r.sequencial||''}`;}
function deriveIds(r){
  const id=String(r.numeroControlePNCP||r.idContratacaoPNCP||'');
  const m=id.match(/^(\d{14})-1-(\d+)\/(\d{4})$/);
  if(m) return {cnpj:m[1],seq:Number(m[2]),ano:Number(m[3])};
  return {cnpj:cleanDigits(r.orgaoEntidade?.cnpj||r.orgaoEntidadeCnpj||r.cnpj||''),seq:Number(r.sequencialCompra||r.sequencialCompraPncp||r.sequencial||0),ano:Number(r.anoCompra||r.anoCompraPncp||r.ano||0)};
}
function normalizeResult(r, fonte='PNCP'){
  const ids=deriveIds(r);
  const modalidadeId=r.modalidadeId??r.codigoModalidade??r.modalidadeIdPncp??r.modalidade;
  const modoId=r.modoDisputaId??r.codigoModoDisputa??r.modoDisputaIdPncp;
  const org=r.orgaoEntidade||{}; const uni=r.unidadeOrgao||{};
  const uf=r.uf||uni.ufSigla||r.unidadeOrgaoUfSigla||r.unidadeSubrogadaUfSigla||'';
  const municipio=r.municipio||uni.municipioNome||r.unidadeOrgaoMunicipioNome||r.unidadeSubrogadaMunicipioNome||'';
  return {
    ...r, _fonte:fonte, _key:keyOf(r), _ids:ids,
    numeroControlePNCP:r.numeroControlePNCP||r.idContratacaoPNCP||null,
    numeroCompra:r.numeroCompra||null,
    anoCompra:r.anoCompra||r.anoCompraPncp||ids.ano||null,
    processo:r.processo||r.numeroProcesso||null,
    modalidadeId: modalidadeId!=null?Number(modalidadeId):null,
    modalidadeNome:r.modalidadeNome||r.modalidadeNomePncp||MODALIDADE_BY_ID.get(String(modalidadeId))||r.nome_modalidade||null,
    modoDisputaId: modoId!=null?Number(modoId):null,
    modoDisputaNome:r.modoDisputaNome||r.modoDisputaNomePncp||MODO_BY_ID.get(String(modoId))||null,
    situacaoCompraNome:r.situacaoCompraNome||r.situacaoCompraNomePncp||r.situacao_aviso||null,
    objetoCompra:r.objetoCompra||r.objeto||r.ds_objeto_licitacao||'',
    informacaoComplementar:r.informacaoComplementar||r.informacoes_gerais||'',
    valorTotalEstimado:Number(r.valorTotalEstimado??r.valor_estimado_total??0),
    valorTotalHomologado:Number(r.valorTotalHomologado??r.valor_homologado_total??0),
    dataAberturaProposta:r.dataAberturaProposta||r.dataAberturaPropostaPncp||r.data_abertura_proposta||null,
    dataEncerramentoProposta:r.dataEncerramentoProposta||r.dataEncerramentoPropostaPncp||r.dataFimRecebimentoPropostas||r.dataFimRecebimentoProposta||r.dataEncerramentoRecebimentoPropostas||r.data_entrega_proposta||null,
    dataPublicacaoPncp:r.dataPublicacaoPncp||r.dataDivulgacaoPncp||r.dataPublicacao||r.data_publicacao||null,
    dataAtualizacaoPncp:r.dataAtualizacaoPncp||r.dt_alteracao||null,
    orgaoEntidade:{cnpj:org.cnpj||r.orgaoEntidadeCnpj||r.orgao||ids.cnpj,razaoSocial:org.razaoSocial||r.orgaoEntidadeRazaoSocial||r.orgao||r.orgao_uasg||null,poderId:org.poderId||r.orgaoEntidadePoderId||null,esferaId:org.esferaId||r.orgaoEntidadeEsferaId||null},
    unidadeOrgao:{codigoUnidade:uni.codigoUnidade||r.unidadeOrgaoCodigoUnidade||r.codigoUnidade||r.uasg||null,nomeUnidade:uni.nomeUnidade||r.unidadeOrgaoNomeUnidade||r.nomeUnidade||null,municipioNome:municipio,municipioId:uni.municipioId||r.unidadeOrgaoCodigoIbge||r.codigoMunicipioIbge||null,ufSigla:uf,ufNome:uni.ufNome||r.unidadeOrgaoUfNome||uf},
    linkSistemaOrigem:r.linkSistemaOrigem||r.endereco_entrega_edital||null,
    urlPncp: ids.cnpj&&ids.ano&&ids.seq ? `https://pncp.gov.br/app/editais/${ids.cnpj}/${ids.ano}/${ids.seq}` : null
  };
}
function isOpenProposal(r){
  const endValue = r.dataEncerramentoProposta
    || r.dataFimRecebimentoPropostas
    || r.dataFimRecebimentoProposta
    || r.dataEncerramentoRecebimentoPropostas
    || r.dataEntregaProposta;
  const end=parseDate(endValue);
  // Se o endpoint de propostas retornar o registro sem data de encerramento,
  // consideramos o próprio endpoint como fonte de verdade e não descartamos.
  return !end || end.getTime()>=Date.now();
}
function matchesKeyword(r, keyword){
  if(!keyword) return true;
  const q=normalizeText(keyword); const words=q.split(/\s+/).filter(Boolean);
  const hay=normalizeText([r.objetoCompra,r.informacaoComplementar,r.modalidadeNome,r.modoDisputaNome,r.orgaoEntidade?.razaoSocial,r.unidadeOrgao?.nomeUnidade,r.unidadeOrgao?.municipioNome].join(' '));
  return words.every(w=>hay.includes(w));
}
function applyStrictFilters(rows, filters){
  let out=rows;
  // UF, cidade e modalidade são aplicados exclusivamente no navegador,
  // sobre o conjunto de resultados já encontrado pela busca principal.
  if(filters.status==='publicacao' || filters.status==='ambos') out=out.filter(isOpenProposal);
  return out;
}
async function pncpList(mode, params){
  const route=mode==='proposta'?'/v1/contratacoes/proposta':'/v1/contratacoes/publicacao';
  const data=await fetchJson(buildUrl(PNCP_CONSULTA,route,params));
  return {rows:resultArray(data).map(x=>normalizeResult(x,'PNCP')),meta:pageMeta(data)};
}
async function comprasList(params){
  const data=await fetchJson(buildUrl(COMPRAS,'/modulo-contratacoes/1_consultarContratacoes_PNCP_14133',params));
  return {rows:resultArray(data).map(x=>normalizeResult(x,'Compras.gov.br')),meta:pageMeta(data)};
}
function dedupe(rows){ const m=new Map(); for(const r of rows){const k=r.numeroControlePNCP||r._key; if(!m.has(k))m.set(k,r); else {const old=m.get(k);m.set(k,{...old,...r,_fonte:[old._fonte,r._fonte].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' + ')});}} return [...m.values()]; }
async function searchSource(mode, filters){
  // O endpoint /contratacoes/proposta exige codigoModalidadeContratacao.
  // Para trazer TODAS as oportunidades abertas sem pedir modalidade ao usuário,
  // consultamos as modalidades uma a uma, com espaçamento e retry para evitar 429.
  const today=new Date();
  const dateTo=filters.dataFinal||fmtYYYYMMDD(today);
  const errors=[];
  const rows=[];
  const delayBetweenRequests=1800;

  for(let i=0;i<MODALIDADES.length;i++){
    const modalidade=MODALIDADES[i];
    try{
      if(i>0) await sleep(delayBetweenRequests);
      const params={
        dataFinal:dateTo,
        pagina:1,
        tamanhoPagina:50,
        codigoModalidadeContratacao:modalidade.id
      };
      const x=await pncpList('proposta',params);
      rows.push(...x.rows);
    }catch(e){
      errors.push(`Modalidade ${modalidade.id} (${modalidade.nome}): ${e.message}`);
    }
  }

  // O endpoint já representa recebimento de propostas em aberto. A validação
  // abaixo aceita os diferentes nomes de campo encontrados nas respostas do PNCP.
  const out=dedupe(rows).filter(isOpenProposal);
  return {rows:out,errors};
}

async function searchCompras(filters){
  // Os filtros de UF/cidade/modalidade são pós-processados. Para evitar
  // consultas adicionais e resultados incompletos, a busca principal usa o PNCP.
  return {rows:[],errors:[]};
}
async function getDetail(cnpj,ano,seq){
  const key=`detail:${cnpj}:${ano}:${seq}`; const hit=cacheGet(key); if(hit!==null)return hit;
  let detail=null, docs=[], items=[], history=[]; const errors=[];
  try{detail=normalizeResult(await fetchJson(`${PNCP_CONSULTA}/v1/orgaos/${cnpj}/compras/${ano}/${seq}`,{ttl:DETAIL_TTL}),'PNCP');}catch(e){errors.push('Detalhe PNCP: '+e.message)}
  const attempts=[
    ['documentos',`${PNCP_API}/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`],
    ['itens',`${PNCP_API}/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens`],
    ['historico',`${PNCP_API}/v1/orgaos/${cnpj}/compras/${ano}/${seq}/historico`]
  ];
  for(const [kind,url] of attempts){try{const d=await fetchJson(url,{ttl:DETAIL_TTL});if(kind==='documentos')docs=Array.isArray(d?.documentos)?d.documentos:resultArray(d);else if(kind==='itens')items=Array.isArray(d?.itens)?d.itens:resultArray(d);else history=Array.isArray(d?.historico)?d.historico:resultArray(d); }catch(e){errors.push(`${kind}: ${e.message}`)}}
  if(!detail) throw new Error('Não foi possível obter o detalhe da contratação no PNCP.');
  const out={detail,documentos:docs,itens:items,historico:history,errors};
  return cacheSet(key,out,DETAIL_TTL);
}

app.get('/api/config', (req,res)=>res.json({modalidades:MODALIDADES,modosDisputa:MODOS,ufs:[...UF].sort(),fontes:['PNCP','Compras.gov.br']}));
app.get('/api/processos', async (req,res)=>{
  try{
    // A pesquisa inicial tem uma única finalidade: trazer contratações que
    // estão recebendo propostas. Os demais filtros são aplicados no cliente,
    // depois que os resultados chegam.
    const today=new Date();
    const dateTo=fmtYYYYMMDD(today);
    const filters={status:'propostas_abertas',dataFinal:dateTo};
    const result=await searchSource('proposta',filters);
    let rows=dedupe(result.rows);

    rows.sort((a,b)=>new Date(b.dataPublicacaoPncp||0)-new Date(a.dataPublicacaoPncp||0));
    const limit=clampInt(req.query.limite,10,50,50);
    const page=1;
    const paginas=Math.max(1,Math.ceil(rows.length/limit));

    res.json({
      resultado:rows,
      totalRegistros:rows.length,
      pagina:page,
      tamanhoPagina:limit,
      paginas,
      fontes:[...new Set(rows.flatMap(r=>String(r._fonte||'').split(' + ')))],
      avisos:result.errors||[],
      filtros:filters
    });
  }catch(e){res.status(502).json({error:e.message||'Falha ao consultar o PNCP.'});}
});

app.get('/api/processos/:cnpj/:ano/:seq', async(req,res)=>{try{res.json(await getDetail(cleanDigits(req.params.cnpj),Number(req.params.ano),Number(req.params.seq)));}catch(e){res.status(502).json({error:e.message});}});
app.get('/api/health',(req,res)=>res.json({ok:true,service:'ST Processos',time:new Date().toISOString()}));
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`ST Processos ouvindo em http://localhost:${PORT}`));
