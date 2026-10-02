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
    dataEncerramentoProposta:r.dataEncerramentoProposta||r.dataEncerramentoPropostaPncp||r.data_entrega_proposta||null,
    dataPublicacaoPncp:r.dataPublicacaoPncp||r.dataPublicacaoPncp||r.data_publicacao||null,
    dataAtualizacaoPncp:r.dataAtualizacaoPncp||r.dt_alteracao||null,
    orgaoEntidade:{cnpj:org.cnpj||r.orgaoEntidadeCnpj||r.orgao||ids.cnpj,razaoSocial:org.razaoSocial||r.orgaoEntidadeRazaoSocial||r.orgao||r.orgao_uasg||null,poderId:org.poderId||r.orgaoEntidadePoderId||null,esferaId:org.esferaId||r.orgaoEntidadeEsferaId||null},
    unidadeOrgao:{codigoUnidade:uni.codigoUnidade||r.unidadeOrgaoCodigoUnidade||r.codigoUnidade||r.uasg||null,nomeUnidade:uni.nomeUnidade||r.unidadeOrgaoNomeUnidade||r.nomeUnidade||null,municipioNome:municipio,municipioId:uni.municipioId||r.unidadeOrgaoCodigoIbge||r.codigoMunicipioIbge||null,ufSigla:uf,ufNome:uni.ufNome||r.unidadeOrgaoUfNome||uf},
    linkSistemaOrigem:r.linkSistemaOrigem||r.endereco_entrega_edital||null,
    urlPncp: ids.cnpj&&ids.ano&&ids.seq ? `https://pncp.gov.br/app/editais/${ids.cnpj}/${ids.ano}/${ids.seq}` : null
  };
}
function isOpenProposal(r){ const end=parseDate(r.dataEncerramentoProposta); return end ? end.getTime()>=Date.now() : false; }
function matchesKeyword(r, keyword){
  if(!keyword) return true;
  const q=normalizeText(keyword); const words=q.split(/\s+/).filter(Boolean);
  const hay=normalizeText([r.objetoCompra,r.informacaoComplementar,r.modalidadeNome,r.modoDisputaNome,r.orgaoEntidade?.razaoSocial,r.unidadeOrgao?.nomeUnidade,r.unidadeOrgao?.municipioNome].join(' '));
  return words.every(w=>hay.includes(w));
}
function applyStrictFilters(rows, filters){
  let out=rows;

  // IMPORTANTE: a API do PNCP nem sempre devolve o mesmo campo de código de
  // modalidade em todas as consultas/fontes. Por isso o nome da modalidade
  // é a confirmação final quando estiver disponível; o código fica como
  // fallback para registros que não tragam o nome.
  if(filters.modalidade){
    const wantedId=Number(filters.modalidade);
    const wantedName=normalizeText(MODALIDADE_BY_ID.get(String(filters.modalidade))||'');
    out=out.filter(r=>{
      const rowName=normalizeText(r.modalidadeNome||'');
      if(rowName && wantedName) return rowName===wantedName;
      return Number(r.modalidadeId)===wantedId;
    });
  }

  if(filters.modoDisputa){
    const wantedId=Number(filters.modoDisputa);
    const wantedName=normalizeText(MODO_BY_ID.get(String(filters.modoDisputa))||'');
    out=out.filter(r=>{
      const rowName=normalizeText(r.modoDisputaNome||'');
      if(rowName && wantedName) return rowName===wantedName;
      return Number(r.modoDisputaId)===wantedId;
    });
  }

  if(filters.uf) out=out.filter(r=>normalizeText(r.unidadeOrgao?.ufSigla)===normalizeText(filters.uf));

  // Cidade é independente da UF. A comparação é exata, ignorando acentos,
  // espaços extras e maiúsculas/minúsculas.
  if(filters.municipio) out=out.filter(r=>normalizeText(r.unidadeOrgao?.municipioNome)===normalizeText(filters.municipio));

  // Situação também é um filtro REAL. "Somente publicados" não pode retornar
  // contratações cujo prazo de propostas já terminou. O indicador de abertura
  // usa a mesma regra mostrada na tabela: data de encerramento >= agora.
  if(filters.status==='publicacao') out=out.filter(isOpenProposal);
  if(filters.status==='ambos') out=out.filter(isOpenProposal);

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
  const today=new Date();
  // O PNCP exige datas na consulta de publicações. Elas continuam opcionais
  // na interface: quando apenas uma é informada, completamos o outro limite;
  // quando ambas estão vazias, usamos o maior período permitido pelo sistema.
  const dateTo=filters.dataFinal||fmtYYYYMMDD(today);
  const dateFrom=filters.dataInicial||fmtYYYYMMDD(new Date(new Date(dateTo.slice(0,4)+'-'+dateTo.slice(4,6)+'-'+dateTo.slice(6,8)+'T00:00:00').getTime()-365*86400000));
  const rows=[]; const errors=[];

  // A API de propostas abertas exige codigoModalidadeContratacao.
  // Se o usuário não escolher uma modalidade, consultamos as modalidades
  // sequencialmente para não provocar HTTP 429 por excesso de requisições.
  if(mode==='proposta'){
    const modalities=filters.modalidade ? [Number(filters.modalidade)] : MODALIDADES.map(x=>x.id);
    for(let i=0;i<modalities.length;i++){
      const id=modalities[i];
      const params={
        dataFinal:dateTo,
        pagina:1,
        tamanhoPagina:50,
        codigoModalidadeContratacao:id,
        uf:filters.uf,
        codigoMunicipioIbge:filters.codigoMunicipioIbge,
        codigoModoDisputa:filters.modoDisputa ? Number(filters.modoDisputa) : undefined
      };
      try{
        const x=await pncpList('proposta',params);
        rows.push(...x.rows);
      }catch(e){ errors.push(`Modalidade ${id}: ${e.message}`); }
      if(i<modalities.length-1) await sleep(700);
    }
  } else {
    // Publicação exige modalidade. Quando o usuário não escolhe uma, fazemos as
    // modalidades uma por vez, com pequeno intervalo, respeitando o rate limit.
    const modalities=filters.modalidade ? [Number(filters.modalidade)] : MODALIDADES.map(x=>x.id);
    for(let i=0;i<modalities.length;i++){
      const id=modalities[i];
      const p={
        dataInicial:dateFrom,
        dataFinal:dateTo,
        codigoModalidadeContratacao:id,
        pagina:1,
        tamanhoPagina:50,
        uf:filters.uf,
        codigoMunicipioIbge:filters.codigoMunicipioIbge,
        codigoModoDisputa:filters.modoDisputa ? Number(filters.modoDisputa) : undefined
      };
      try{
        const x=await pncpList('publicacao',p);
        rows.push(...x.rows);
      }catch(e){ errors.push(e.message); }
      if(i<modalities.length-1) await sleep(550);
    }
  }

  let out=dedupe(rows).filter(r=>matchesKeyword(r,filters.keyword));
  out=applyStrictFilters(out,filters);
  return {rows:out,errors};
}

async function searchCompras(filters){
  // O endpoint do Compras.gov.br exige codigoModalidade. Para buscas amplas,
  // o PNCP já cobre todas as modalidades; evitamos 13 chamadas extras ao
  // Compras.gov.br. Quando a modalidade foi escolhida, fazemos a consulta
  // complementar na fonte oficial.
  if(!filters.modalidade) return {rows:[],errors:[]};
  const rows=[]; const errors=[];
  try{
    const p={
      pagina:1,
      tamanhoPagina:500,
      dataPublicacaoPncpInicial:`${filters.dataInicial.slice(0,4)}-${filters.dataInicial.slice(4,6)}-${filters.dataInicial.slice(6,8)}`,
      dataPublicacaoPncpFinal:`${filters.dataFinal.slice(0,4)}-${filters.dataFinal.slice(4,6)}-${filters.dataFinal.slice(6,8)}`,
      codigoModalidade:Number(filters.modalidade),
      unidadeOrgaoUfSigla:filters.uf,
      unidadeOrgaoCodigoIbge:filters.codigoMunicipioIbge
    };
    const x=await comprasList(p); rows.push(...x.rows);
  }catch(e){errors.push(e.message)}
  let out=dedupe(rows).filter(r=>matchesKeyword(r,filters.keyword));
  out=applyStrictFilters(out,filters);
  return {rows:out,errors};
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
    const f=req.query; const today=new Date();
    const mode=['publicacao','ambos'].includes(f.status)?f.status:'';
    const rawStart=String(f.dataInicial||'').trim();
    const rawEnd=String(f.dataFinal||'').trim();
    if((rawStart && !/^\d{8}$/.test(rawStart))||(rawEnd && !/^\d{8}$/.test(rawEnd)))return res.status(400).json({error:'Datas devem estar no formato AAAAMMDD.'});

    // Datas também são opcionais. Para atender a exigência da API do PNCP,
    // completamos somente o limite que estiver ausente.
    let start=rawStart, end=rawEnd;
    if(!start && !end){
      end=fmtYYYYMMDD(today);
      start=fmtYYYYMMDD(new Date(today.getTime()-365*86400000));
    }else if(!start){
      const d=new Date(`${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T00:00:00`);
      start=fmtYYYYMMDD(new Date(d.getTime()-365*86400000));
    }else if(!end){
      const d=new Date(`${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)}T00:00:00`);
      end=fmtYYYYMMDD(new Date(Math.min(Date.now(),d.getTime()+365*86400000)));
    }

    const startDate=new Date(`${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)}T00:00:00`);
    const endDate=new Date(`${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T00:00:00`);
    if(endDate<startDate)return res.status(400).json({error:'A data final não pode ser anterior à data inicial.'});
    if(endDate-startDate>365*86400000)return res.status(400).json({error:'O período máximo é de 365 dias.'});
    if(f.uf && !UF.has(String(f.uf).toUpperCase())) return res.status(400).json({error:'UF inválida.'});
    const filters={...f,status:mode,dataInicial:start,dataFinal:end,
      uf:f.uf?String(f.uf).toUpperCase():'',
      modalidade:f.modalidade||'',modoDisputa:f.modoDisputa||'',
      keyword:String(f.keyword||'').trim(),
      municipio:String(f.municipio||'').trim()};
    // “Somente publicados” = tudo que foi publicado no período.
    // “Publicados + recebendo propostas” = interseção: publicado e prazo de
    // propostas ainda aberto. Não exibimos processos encerrados nesse modo.
    const modes=mode==='ambos'?['publicacao','proposta']:mode? [mode] : ['publicacao'];
    const sourceResults=[];
    for(const sourceMode of modes){ sourceResults.push(await searchSource(sourceMode,filters)); }
    let rows=dedupe(sourceResults.flatMap(x=>x.rows));
    if(mode==='ambos') rows=rows.filter(isOpenProposal);
    const c=await searchCompras(filters); rows=dedupe(rows.concat(c.rows)); sourceResults.push(c);
    if(mode==='ambos') rows=rows.filter(isOpenProposal);
    rows.sort((a,b)=>new Date(b.dataPublicacaoPncp||0)-new Date(a.dataPublicacaoPncp||0));
    const limit=clampInt(f.limite,10,200,100); const page=clampInt(f.pagina,1,1000,1); const slice=rows.slice((page-1)*limit,page*limit);
    res.json({resultado:slice,totalRegistros:rows.length,pagina:page,tamanhoPagina:limit,paginas:Math.max(1,Math.ceil(rows.length/limit)),fontes:[...new Set(rows.flatMap(r=>String(r._fonte||'').split(' + ')))],avisos:[...new Set(sourceResults.flatMap(x=>x.errors||[]))].slice(0,8),filtros:filters});
  }catch(e){res.status(502).json({error:e.message||'Falha ao consultar fontes públicas.'});}
});
app.get('/api/processos/:cnpj/:ano/:seq', async(req,res)=>{try{res.json(await getDetail(cleanDigits(req.params.cnpj),Number(req.params.ano),Number(req.params.seq)));}catch(e){res.status(502).json({error:e.message});}});
app.get('/api/health',(req,res)=>res.json({ok:true,service:'ST Processos',time:new Date().toISOString()}));
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`ST Processos ouvindo em http://localhost:${PORT}`));
