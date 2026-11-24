export type DesignPalette={background:string;accent:string;text:string};
export type ProjectLesson={observation:string;action:string;reference:string};
export const designPalettes:{name:string;palette:DesignPalette}[]=[
  {name:'Noturno',palette:{background:'#111827',accent:'#60A5FA',text:'#F9FAFB'}},
  {name:'Editorial',palette:{background:'#F8F5EF',accent:'#8B3D28',text:'#202020'}},
  {name:'Natural',palette:{background:'#F2F7F4',accent:'#24654D',text:'#172C24'}},
];
export function validPalette(value:unknown):value is DesignPalette{
  if(!value||typeof value!=='object')return false;
  const p=value as DesignPalette;
  return [p.background,p.accent,p.text].every(x=>typeof x==='string'&&/^#[a-f0-9]{6}$/i.test(x));
}
export function validLesson(value:unknown):value is ProjectLesson{
  if(!value||typeof value!=='object')return false;
  const x=value as ProjectLesson;
  if(![x.observation,x.action].every(v=>typeof v==='string'&&!!v.trim()&&v.length<=240))return false;
  if(typeof x.reference!=='string'||x.reference.length>300)return false;
  try{const u=new URL(x.reference);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search;}catch{return false;}
}
export function addLesson(p:ProjectProfile,l:ProjectLesson):ProjectProfile{
  if(!validLesson(l))throw Error('Informe observação, ação e referência HTTPS sem credenciais ou parâmetros.');
  if((p.lessons?.length??0)>=10)throw Error('Limite de 10 lições por projeto.');
  return {...p,lessons:[...(p.lessons??[]),{...l}]};
}
export type ProjectProfile={id:string;name:string;purpose:string;visual:string;preferences:string;constraints:string;criteria:string;design?:DesignPalette;lessons?:ProjectLesson[]};
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
  return typeof x.id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(x.id)&&keys.every(k=>typeof x[k]==='string'&&x[k].length<=(k==='name'?80:1600))&&!!x.name.trim()&&!!x.purpose.trim()&&(x.design===undefined||validPalette(x.design))&&
    (x.lessons===undefined||(Array.isArray(x.lessons)&&x.lessons.length<=10&&x.lessons.every(validLesson)));
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
export type FactoryMode='new'|'change';
export type FactoryDraft={profile:ProjectProfile;request:string;mode:FactoryMode};
export type FactorySession={selected?:string;drafts:Record<string,FactoryDraft>};
export function mergeProfiles(existing:ProjectProfile[],incoming:ProjectProfile[]):ProjectProfile[]{
  let result=[...existing];
  for(const p of incoming)if(!result.some(x=>x.id===p.id))result=saveProfile(result,p);
  return result;
}
export function buildPrompt(p:ProjectProfile,request:string,mode:FactoryMode='new'):string{
  if(!validateProfile(p))throw Error('Preencha o perfil do projeto.');
  if(!request.trim()||request.length>2000)throw Error('Descreva o pedido em até 2.000 caracteres.');
  const field=(s:string)=>s.trim()||'Não definido: preserve o existente e explicite qualquer suposição.';
  return [
    '# NEXUS FACTORY | Briefing reutilizável', 'Projeto: '+p.name.trim(),
    'Objetivo do projeto: '+p.purpose.trim(),'Pedido atual: '+request.trim(),
    'Modo: '+(mode==='change'?'Laboratório de alterações, versão principal protegida':'Criação de projeto'),
    ...(mode==='change'?['Inspecione o estado atual e estabeleça uma linha de base. Crie branch/worktree isolada a partir do SHA confirmado; não altere a branch principal, banco de produção ou publicação atual. Teste regressões, compare antes/depois e entregue prévia separada com plano de rollback. Integração somente depois de aprovação explícita.']:['Expanda o pedido mínimo em requisitos, arquitetura, fluxo, dados, segurança, interface provisória, implementação, testes e entrega. Complete detalhes operacionais razoáveis; não trate suposições como decisões do fundador.']),
    'Design, layout e briefing finais são decisões do fundador. Apresente a proposta visual e mantenha a publicação final bloqueada até aprovação explícita.',
    '## Identidade visual (cores, tipografia, layout, referências)',field(p.visual),
    ...(p.design?['Proposta de paleta selecionada para avaliação pelo fundador (não é aprovação final): fundo '+p.design.background+'; destaque '+p.design.accent+'; texto '+p.design.text]:[]),
    ...(p.lessons?.length?['## Knowledge Core — lições registradas pelo usuário, conferir referências antes de aplicar',...p.lessons.map(l=>'- Observação: '+l.observation+' | Ação: '+l.action+' | Referência: '+l.reference)]:[]),
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

// Only fill missing fields on new projects. Existing identities remain unchanged.
export function quickProfile(profile:ProjectProfile,request:string,mode:FactoryMode):ProjectProfile{
  const ask=request.trim();
  if(!ask||request.length>2000)throw Error('Descreva seu pedido em até 2.000 caracteres.');
  if(mode==='change'){
    if(!validateProfile(profile))throw Error('Selecione ou complete o perfil do projeto existente.');
    return profile;
  }
  const result={...profile,name:profile.name.trim()||('Rascunho: '+ask.replace(/\s+/g,' ')).slice(0,80),
    purpose:profile.purpose.trim()||('Objetivo provisório, a confirmar: '+ask).slice(0,1600)};
  if(!validateProfile(result))throw Error('Confira o perfil do projeto.');
  return result;
}
