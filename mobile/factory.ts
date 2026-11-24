export type ProjectProfile={id:string;name:string;purpose:string;visual:string;preferences:string;constraints:string;criteria:string};
export const factoryDefaults=[
  'Priorize a experiência do cliente e a acessibilidade, inclusive em telas pequenas.',
  'Preserve dados e funções existentes. Não misture identidades nem informações de projetos distintos.',
  'Planeje antes de programar. Considere segurança, custos, manutenção, eficiência e retorno real.',
  'Não amplie permissões, use serviços pagos ou publique em produção sem autorização específica.',
  'Distingua resultados verificados, hipóteses e pendências. Nunca invente testes ou autoria.',
];
const keys=['name','purpose','visual','preferences','constraints','criteria'] as const;
export const emptyProfile=(id:string):ProjectProfile=>({id,name:'',purpose:'',visual:'',preferences:'',constraints:'',criteria:''});
export function validateProfile(p:unknown):p is ProjectProfile {
  if(!p||typeof p!=='object')return false;
  const x=p as ProjectProfile;
  return typeof x.id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(x.id)&&keys.every(k=>typeof x[k]==='string'&&x[k].length<=(k==='name'?80:1600))&&!!x.name.trim()&&!!x.purpose.trim();
}
export function decodeProfiles(value:string|null):ProjectProfile[]{
  if(value===null)return [];
  const data=JSON.parse(value);
  if(!Array.isArray(data)||data.length>30||!data.every(validateProfile)||new Set(data.map(x=>x.id)).size!==data.length)
    throw Error('Perfis locais inválidos. Não serão substituídos automaticamente.');
  return data;
}
export function saveProfile(list:ProjectProfile[],p:ProjectProfile):ProjectProfile[]{
  if(!validateProfile(p))throw Error('Informe nome e objetivo. Respeite os limites dos campos.');
  const result=list.some(x=>x.id===p.id)?list.map(x=>x.id===p.id?{...p}:x):[...list,{...p}];
  if(result.length>30)throw Error('Limite de 30 projetos.');
  return result;
}
export function buildPrompt(p:ProjectProfile,request:string):string{
  if(!validateProfile(p))throw Error('Preencha o perfil do projeto.');
  if(!request.trim()||request.length>2000)throw Error('Descreva o pedido em até 2.000 caracteres.');
  const field=(s:string)=>s.trim()||'Não definido: preserve o existente e explicite qualquer suposição.';
  return [
    '# NEXUS FACTORY | Briefing reutilizável', 'Projeto: '+p.name.trim(),
    'Objetivo do projeto: '+p.purpose.trim(),'Pedido atual: '+request.trim(),
    '## Identidade visual (cores, tipografia, layout, referências)',field(p.visual),
    '## Preferências de experiência e tecnologia',field(p.preferences),
    '## Restrições específicas',field(p.constraints),
    '## Critérios específicos de aceite',field(p.criteria),
    '## Padrão de trabalho',...factoryDefaults.map(x=>'- '+x),
    '## Colaboração verificável',
    '- ChatGPT: arquitetura, escopo, critérios, riscos e implementação quando necessário.',
    '- Codex: implementação ou revisão independente com recibo verificável, PR, SHA e testes.',
    '- IA Pessoal: auditoria independente, evidências, hipóteses e correções.',
    '- Fundador: decisões estratégicas e aprovação final. Não simular a atuação de nenhum agente.',
    '## Entrega', 'Relatório curto por IA, benefício empresarial, resultados comprovados, limitações e rollback. Manter este briefing atualizado no repositório autorizado. Ações externas dependem da integração e autorização reais.',
  ].join('\n\n');
}
