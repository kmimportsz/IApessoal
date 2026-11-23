const site='https://pt.wikipedia.org';
export const searchLimit=12;
export async function searchPublic(query, transport=fetch) {
  const address=new URL('/w/rest.php/v1/search/page',site);
  address.searchParams.set('q',query);address.searchParams.set('limit','5');
  const response=await transport(address,{
    headers:{'User-Agent':'IAPessoal/1.4 (https://github.com/kmimportsz/IApessoal)','Accept':'application/json'},
    signal:AbortSignal.timeout(7500),redirect:'error',
  });
  if(!response.ok) throw Error('Fonte pública indisponível.');
  const data=await response.json();
  if(!Array.isArray(data?.pages)) throw Error('Resposta da fonte inválida.');
  return {searchedAt:new Date().toISOString(),source:'Wikipédia em português',
    results:data.pages.filter(page=>typeof page?.key==='string'&&page.key.length>0&&page.key.length<300&&typeof page.title==='string')
      .slice(0,5).map(page=>({
        title:page.title.slice(0,180),url:site+'/wiki/'+encodeURIComponent(page.key),
        description:String(page.description??'').replace(/<[^>]*>/g,'').slice(0,220),
      }))};
}
