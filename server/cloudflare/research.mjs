const site='https://pt.wikipedia.org';
export const searchLimit=12;
const text = (value, max=220) => String(value??'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,max);
export async function searchPublic(query, transport=fetch) {
  const wiki=new URL('/w/rest.php/v1/search/page',site);
  wiki.searchParams.set('q',query);wiki.searchParams.set('limit','3');
  const cross=new URL('https://api.crossref.org/works');
  cross.searchParams.set('query.bibliographic',query);cross.searchParams.set('rows','3');
  cross.searchParams.set('select','DOI,title,published,publisher,abstract');
  const pmc=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  pmc.searchParams.set('query',query);pmc.searchParams.set('format','json');pmc.searchParams.set('pageSize','3');
  const links=[
    ['Wikipédia',wiki,d=>(d.pages??[]).filter(p=>typeof p.key==='string'&&p.key.length<300).map(p=>({
      title:text(p.title,180),url:site+'/wiki/'+encodeURIComponent(p.key),description:text(p.description),date:null}))],
    ['Crossref',cross,d=>(d.message?.items??[]).filter(p=>/^10\.\d{4,9}\/[a-z0-9._;()/:+-]{1,240}$/i.test(p.DOI??'')).map(p=>({
      title:text(p.title?.[0],180),url:'https://doi.org/'+encodeURI(p.DOI),
      description:text(p.abstract||p.publisher),date:p.published?.['date-parts']?.[0]?.map((x,i)=>String(x).padStart(i===0?4:2,'0')).join('-')??null}))],
    ['Europe PMC',pmc,d=>(d.resultList?.result??[]).filter(p=>['MED','PMC'].includes(p.source)&&/^(?:PMC)?\d{1,12}$/.test(p.id??'')).map(p=>({
      title:text(p.title,180),url:'https://europepmc.org/article/'+p.source+'/'+p.id,description:text(p.journalTitle),
      date:/^\d{4}(-\d{2}-\d{2})?$/.test(p.firstPublicationDate??p.pubYear??'')?(p.firstPublicationDate??p.pubYear):null}))],
  ];
  const reports=await Promise.all(links.map(async ([source,url,adapt])=>{
    try {
      const response=await transport(url,{headers:{'User-Agent':'IAPessoal/1.5 (https://github.com/kmimportsz/IApessoal)','Accept':'application/json'},
        signal:AbortSignal.timeout(7500),redirect:'error'});
      if(!response.ok) throw Error('Fonte indisponível');
      const data=await response.json();
      return {source,available:true,results:adapt(data).slice(0,3).filter(r=>r.title).map(r=>({...r,source}))};
    } catch {return {source,available:false,results:[]};}
  }));
  if(reports.every(row=>!row.available)) throw Error('Fontes públicas indisponíveis.');
  const seen=new Set();
  const results=reports.flatMap(r=>r.results).filter(row=>{
    const key=row.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    if(seen.has(key)) return false;
    seen.add(key);return true;
  }).slice(0,8);
  return {searchedAt:new Date().toISOString(),source:'Índices públicos',results,
    providers:reports.map(({source,available})=>({source,available}))};
}
