const languages={js:'JavaScript',mjs:'JavaScript',cjs:'JavaScript',jsx:'JavaScript',ts:'TypeScript',tsx:'TypeScript',py:'Python',
  go:'Go',rs:'Rust',java:'Java',kt:'Kotlin',swift:'Swift',rb:'Ruby',sql:'SQL'};
const manifests={
  'package.json':'Node.js', 'pyproject.toml':'Python', 'Cargo.toml':'Rust', 'go.mod':'Go',
  'wrangler.toml':'Cloudflare Workers', 'wrangler.jsonc':'Cloudflare Workers',
  'next.config.js':'Next.js', 'next.config.ts':'Next.js', 'eas.json':'Expo',
};
const rolePatterns=[
  ['Testes',/(^|[/_.-])(tests?|specs?)([/_.-]|$)/i],
  ['Autenticação e acesso',/(^|[/_.-])(auth\w*|session\w*|permission\w*|login|access|policy|middleware)([/_.-]|$)/i],
  ['Persistência',/(^|[/_.-])(schema|db|database|storage|migrations?)([/_.-]|$)|\.sql$/i],
  ['Integração',/(^|[/_.-])(api|gateway|worker|webhooks?|integrations?|routes?)([/_.-]|$)/i],
  ['Interface',/(^|[/_.-])(app|pages?|screens?|components?|ui)([/_.-]|$)|\.[jt]sx$/i],
];
export function fileRole(path) {
  if(Object.hasOwn(manifests,path.split('/').at(-1)))return 'Configuração e dependências';
  return rolePatterns.find(([,pattern])=>pattern.test(path))?.[0]??'Implementação';
}

export function observedDependencies(path,source) {
  if(path.split('/').at(-1)!=='package.json')return [];
  try {
    const manifest=JSON.parse(source);
    const names=[...Object.keys(manifest.dependencies??{}),...Object.keys(manifest.devDependencies??{})];
    return [...new Set(names)].filter(name=>/^(?:@[-\w.]+\/)?[-\w.]+$/.test(name)).slice(0,16);
  } catch {return [];}
}

export function mapRepository(paths,githubLanguage,truncated) {
  const detected=paths.map(path=>languages[path.split('.').at(-1)]).filter(Boolean);
  const frameworks=paths.map(path=>manifests[path.split('/').at(-1)]).filter(Boolean);
  return {
    languages:[...new Set([githubLanguage,...detected].filter(Boolean))].slice(0,12),
    frameworks:[...new Set(frameworks)].slice(0,12),
    directories:[...new Set(paths.filter(path=>path.includes('/')).map(path=>path.split('/')[0]))].sort().slice(0,12),
    critical:paths.filter(path=>['Autenticação e acesso','Persistência','Integração'].includes(fileRole(path))).slice(0,12),
    truncated,
  };
}

export function selectFiles({paths,changed,covered,previous,sha}) {
  const score=path=>(changed.has(path)?12:0)+(!covered.has(path)?8:0)+(previous.has(path)?6:0)+
    (fileRole(path)==='Autenticação e acesso'?4:fileRole(path)==='Implementação'?0:2);
  return [...new Set(paths)].filter(path=>covered.get(path)!==sha)
    .sort((left,right)=>score(right)-score(left)||left.localeCompare(right)).slice(0,8);
}

export function potentialFixes(previous,files,commit) {
  return previous.filter(finding=>{
    const file=files.find(item=>item.path===finding.path);
    const line=file?.lines[finding.line-1]?.trim();
    return finding.commit!==commit && !!line && line.slice(0,420)!==finding.excerpt &&
      !file.lines.some(value=>value.trim().slice(0,420)===finding.excerpt);
  }).map(({id,path,line})=>({id,path,line}));
}
