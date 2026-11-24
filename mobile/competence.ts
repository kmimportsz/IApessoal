import {calculate} from './calculator.mjs';
import {memoryKey, publicResearchTopic, relevantMemory, type Memory} from './core.ts';

const profiles = [
  ['Matemática', /\b(calcul\w*|equacao|porcentagem|probabilidade|fracao)\b/, 'Verifique os operandos e as unidades. Separe o valor exato do arredondamento.'],
  ['Engenharia', /\b(codigo|commit|github|typescript|api|sqlite|bug|autenticacao|arquitetura|teste unitario)\b/, 'Separe evidências de hipóteses e indique uma verificação reproduzível. Não afirme que executou testes ou abriu arquivos.'],
  ['Negócios', /\b(margem|faturamento|precificacao|fluxo de caixa|capital|vendas|custos|lucro|investimento|retorno)\b/, 'Explicite premissas, prazo, custos e riscos. Questione metas incompatíveis com os números e apresente alternativas quando úteis.'],
  ['Pesquisa', /\b(pesquis\w*|fonte\w*|estudo\w*|evidencia\w*)\b/, 'Indique a data e a origem das evidências disponíveis, divergências e lacunas. Não invente fontes.'],
  ['Comunicação', /\b(escreva|reescreva|redija|roteiro|mensagem profissional|comunicado)\b/, 'Adapte tom e formato ao público e preserve os fatos fornecidos.'],
  ['Planejamento', /\b(planej\w*|cronograma|prioridade\w*|roteiro de tarefas|objetivo\w*)\b/, 'Organize próximos passos por impacto, dependências, prazo e esforço.'],
] as const;
type Domain = typeof profiles[number][0] | 'Conversa';
export function assessRequest(prompt:string) {
  const expression=prompt.trim().match(/^(?:calcule\s*:?\s*)?([\d\s()+*/%.,-]+)[?=]?$/iu)?.[1];
  const complete=expression&&/[+*/%-]/.test(expression)&&/\d/.test(expression);
  let arithmetic:ReturnType<typeof calculate>|undefined;
  let invalidArithmetic=false;
  if(complete) {
    try {arithmetic=calculate(expression);} catch {invalidArithmetic=true;}
  }
  const key=memoryKey(prompt);
  const profile=profiles.find(([,pattern])=>pattern.test(key));
  const topic=publicResearchTopic(prompt);
  const specific=complete?profiles[0]:topic?profiles[3]:profile;
  const domain:Domain=specific?.[0]??'Conversa';
  return {domain,topic,arithmetic,invalidArithmetic,method:specific?.[2]};
}

export function trustedResearchUrl(url:string) {
  try {
    const parsed=new URL(url);
    return parsed.protocol==='https:' && !parsed.username && !parsed.password && !parsed.port &&
      ['pt.wikipedia.org','doi.org','europepmc.org'].includes(parsed.hostname);
  } catch {return false;}
}

// The caller supplies only memories with active consent for their current revision.
export function contextualMemory(prompt:string, memories:Memory[], now=Date.now()) {
  const recent=memories.filter(item=>
    !['Compromisso','Objetivo','Projeto','Decisão'].includes(item.kind) || now-item.updated<=180*86400000);
  const candidate=relevantMemory(prompt,recent);
  if(!candidate)return;
  const tokens=new Set(memoryKey(prompt).split(' ').filter(word=>word.length>=5));
  const hits=(body:string)=>new Set(memoryKey(body).split(' ').filter(word=>tokens.has(word))).size;
  const coverage=hits(candidate.body);
  if(coverage<2)return;
  if(recent.some(other=>other.id!==candidate.id && !other.private && other.kind===candidate.kind &&
    memoryKey(other.body)!==memoryKey(candidate.body) && hits(other.body)>=coverage))return;
  return candidate;
}

export function competencyChecks() {
  const tests:[string,string,boolean][]=[
    ['Matemática','Calcula 0,1 + 0,2 com precisão',assessRequest('Calcule 0,1+0,2').arithmetic?.exact==='3/10'],
    ['Matemática','Identifica divisão por zero',assessRequest('1/0').invalidArithmetic],
    ['Negócios','Reconhece pedido de margem',assessRequest('Avalie a margem e o faturamento').domain==='Negócios'],
    ['Engenharia','Reconhece diagnóstico de API',assessRequest('Por que a API falha nesse commit?').domain==='Engenharia'],
    ['Pesquisa','Aceita fonte pública e rejeita domínio parecido',trustedResearchUrl('https://doi.org/10.1/test')&&!trustedResearchUrl('https://doi.org.exemplo.test/')],
    ['Pesquisa','Mantém dados pessoais fora da pesquisa automática',!assessRequest('Pesquise sobre minha conta').topic],
    ['Comunicação','Distingue escrita de conversa casual',assessRequest('Redija um comunicado').domain==='Comunicação'&&assessRequest('Oi, tudo bem?').domain==='Conversa'],
    ['Planejamento','Reconhece um cronograma',assessRequest('Crie um cronograma').domain==='Planejamento'],
  ];
  return tests;
}
