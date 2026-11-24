/**
 * IA Pessoal | Excellence Engine 1.6.2
 *
 * Uma proposta de entrega nao se torna aprovada por elogio, aparencia,
 * resposta do modelo ou pontuacao arbitraria.
 *
 * Esta avaliacao e deterministica. O chamador PRECISA verificar origem e
 * autenticidade de cada atestacao: texto gerado pelo LLM nunca e prova.
 */
export const qualityAxes = Object.freeze([
  {id:'objective',label:'Objetivo e requisitos'},
  {id:'correctness',label:'Funcionamento e testes'},
  {id:'experience',label:'Experiencia de quem usa'},
  {id:'security',label:'Privacidade e seguranca'},
  {id:'resilience',label:'Desempenho e recuperacao'},
  {id:'delivery',label:'Entrega, documentacao e rollback'},
]);

const highSeverity = new Set(['critical','high','critica','crítica','alta','blocking','bloqueante']);
const supportedOrigin = new Set(['automated-test','ci-check','manual-review','runtime-measurement']);
const requiredRevision = /^[a-f0-9]{40}$/i;

/**
 * Atestacoes devem vir da camada de ferramentas verificadas, nunca do modelo.
 * O estado verified exige vinculacao a revisao e origem autenticada pelo
 * adaptador. Aprovado significa que TODOS os criterios acordados passaram
 * com evidencia, nao perfeicao absoluta nem ausencia de riscos futuros.
 */
export function evaluateQualityGate({revision,checks=[],findings=[],authorized=false}={}) {
  const sha=typeof revision==='string'&&requiredRevision.test(revision)?revision.toLowerCase():null;
  const byAxis=new Map();
  const warnings=[];
  const blockers=[];
  for(const axis of qualityAxes) {
    const matches=checks.filter(check=>check?.axis===axis.id);
    // Nao confundir registro textual com atestacao confiavel.
    const eligible=matches.filter(check=>check.trusted===true &&
      check.revision===sha && supportedOrigin.has(check.source) &&
      typeof check.evidence==='string' && check.evidence.trim().length>=12 &&
      typeof check.evidenceUrl==='string' && /^https:\/\//i.test(check.evidenceUrl));
    const failed=eligible.some(check=>check.status==='failed');
    const passed=eligible.some(check=>check.status==='passed');
    const state=failed?'failed':passed?'passed':'unverified';
    byAxis.set(axis.id,state);
    if(state!=='passed')blockers.push({axis:axis.id,reason:state==='failed'?'Verificacao falhou':'Evidencia verificada ausente'});
  }
  for(const finding of findings) {
    if(finding?.status==='resolved' || finding?.status==='dismissed')continue;
    if(highSeverity.has(String(finding?.severity??'').toLowerCase())) {
      blockers.push({axis:'open-findings',reason:'Descoberta importante sem resolucao comprovada'});
    } else if(finding?.status==='open') warnings.push('Existem observacoes abertas de prioridade inferior.');
  }
  if(!sha)blockers.push({axis:'revision',reason:'Revisao nao identificada'});
  if(!authorized)blockers.push({axis:'release',reason:'Aprovacao do proprietario necessaria'});
  return {
    state:blockers.length?'blocked':'approved-for-review',
    approved:blockers.length===0,
    revision:sha,
    axes:Object.fromEntries(byAxis),
    blockers,
    warnings:[...new Set(warnings)],
    explanation:blockers.length?'Ainda nao existe evidencia suficiente para declarar a entrega pronta.':
      'Criterios verificados para esta revisao; liberacao continua sujeita ao proprietario e a riscos futuros.',
  };
}

export const excellencePolicy = [
  'DIRETORIA DE EXCELENCIA: aja como revisora independente, muito exigente, mas justa.',
  'A essencia do proprietario e preservar a visao e exigir acabamento excepcional, simplicidade, confiabilidade e experiencia real de uso.',
  'Em projetos complexos: defina requisitos e criterios de aceite observaveis; investigue falhas, custo, experiencia do cliente, acessibilidade, seguranca, performance e manutencao.',
  'Questione inclusive o proprio projeto e as propostas do assistente ou do Codex. Nao use elogios para preencher lacunas de evidencia.',
  'Antes de apresentar uma entrega como finalizada, exija evidencias independentes, testes pertinentes, revisao critica, ausencia de bloqueadores e aprovacao final do proprietario.',
  'Se ainda faltarem evidencias, diga exatamente o que falta e proponha a menor sequencia de correcoes e verificacoes para atingir o criterio de aceite.',
  'Uma resposta pode ser completa sem ser longa. Nao esconda trabalho incompleto, nao declare perfeicao absoluta e nao transforme exigencia de qualidade em iteracao infinita.',
  'Voce pode recomendar refatoracao radical quando uma causa estrutural a justificar. Nao altere repositorios, dados ou sistemas sem permissao explicita e ferramentas adequadas.',
  'Ao delegar ao Codex, forneca escopo, restricoes, criterios de aceite, testes, evidencias requeridas e condicao de parada. Nao afirme ter delegado sem integracao real.',
].join(' ');

/** A diretoria de excelencia so intervem em pedidos de construcao, revisao ou entrega. */
export function excellenceGuidance(prompt) {
  const text=String(prompt??'').split('\n\nMensagem atual:\n').at(-1)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const project=/\b(projeto|aplicativo|sistema|codigo|site|software|app|codex|implementa\w*|desenvolv\w*|publica\w*|release|entrega|repositorio|github)\b/;
  const intentional=/\b(criar|crie|construir|desenvolver|desenvolva|avaliar|avalie|revisar|revise|melhorar|melhore|corrigir|implementar|finalizar|entregar|publicar|deploy|arquitetura|qualidade|perfeito|pronto|funciona|seguranca|seguro)\b/;
  return project.test(text) && (intentional.test(text) || text.length>350) ? excellencePolicy : '';
}

export const autonomyQualityGuidance =
  'Ao revisar objetivo autorizado, identifique o risco ou requisito com maior impacto verificavel; nao diga que o projeto esta finalizado ou perfeito sem provas. Se nao houver evidencia ou proxima acao concreta, abstenha-se e nao gere tarefa artificial. Nao amplie permissao nem escopo.';
export const repoQualityGuidance =
  'Priorize problemas verificaveis de funcionamento, experiencia, acessibilidade e seguranca; nao declare que um codigo passou em testes nao executados. Nao classifique como concluida uma entrega so por inspecao textual.';
