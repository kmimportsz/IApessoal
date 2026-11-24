/**
 * IA Pessoal 1.6.2 | Cognitive Intelligence Core
 * Deterministic, bounded routing. User text only selects predefined guidance:
 * it never becomes a system instruction and cannot grant tool permissions.
 */
const domains = Object.freeze([
  {id:'negocios', re:/\b(faturamento|capital de giro|lucro|margem|precific\w*|clientes?|vendas?|despesas?|custos?|investimento|fornecedor|fluxo de caixa|contratar|salarios?|receita mensal)\b|r\s*\$/i,
    guide:'Separe faturamento, margem, lucro e caixa. Valide a aritmetica e explicite prazo, premissas, despesas, riscos e cenarios. Nao descreva metas como realistas sem condicoes verificaveis.'},
  {id:'engenharia', re:/\b(codigo|programa|github|commit|deploy|bug|erro de compilacao|api|typescript|javascript|react|sqlite|supabase|firebase|cloudflare|servidor|banco de dados|autenticacao|seguranca do sistema|integracao)\b/i,
    guide:'Separe causa comprovada de hipotese. Quando o contexto autorizado incluir arquivo, log ou teste, cite sua evidencia. Nao alegue acesso a repositorios, execucao de testes ou deploy sem ferramenta real.'},
  {id:'matematica', re:/\b(calcule|calcular|equacao|fracao|porcentagem|probabilidade|multiplicacao|divisao|media aritmetica)\b/i,
    guide:'Priorize a calculadora deterministica quando disponivel. Verifique operacoes, unidade, arredondamento e interpretacao do enunciado.'},
  {id:'pesquisa', re:/\b(pesquise|pesquisa|fontes?|estudos?|artigos?|documentacao|noticias?|atualizacoes?|evidencias?)\b/i,
    guide:'Diferencie conhecimento geral de fonte consultada. Verifique origem e data da evidencia realmente obtida. Nao invente atualidade, links, autores ou acesso a internet.'},
  {id:'comunicacao', re:/\b(reescreva|redija|mensagem|e-?mail|roteiro|legenda|comunicado|texto profissional|convite|resposta para)\b/i,
    guide:'Preserve a intencao e os fatos do usuario. Adapte tom, formato, audiencia e objetivo, sem acrescentar informacoes nao fornecidas.'},
  {id:'planejamento', re:/\b(planeje|planejamento|cronograma|prioridades?|objetivos?|agenda|projeto|prazo|tarefas?|estrategia)\b/i,
    guide:'Considere dependencias, capacidade, riscos e proximos passos executaveis. Nao confunda sugestao de acao com autorizacao para executa-la.'},
]);

// Risk and uncertainty are separate from complexity. Only fixed guidance is emitted.
const reviewTriggers = Object.freeze([
  {id:'revisao', re:/\b(reconsidere|reavalie|corrija sua resposta|voce errou|tem certeza|contradicoes?|contradicao|refute|refutar|verifique sua conclusao)\b/,
    guide:'Reavalie a conclusao sem defende-la por inercia. Identifique qual premissa ou evidencia mudaria a resposta. Se encontrar erro, corrija-o explicitamente.'},
  {id:'risco', re:/\b(irreversivel|risco(?:s)?|viabilidade|decisao critica|perda de dados|migracao de dados|seguranca|producao|prejuizo)\b/,
    guide:'Antes de recomendar, identifique impacto, incerteza e uma verificacao proporcional. Prefira opcoes reversiveis quando fizer sentido. Nao transforme uma recomendacao em autorizacao.'},
  {id:'evidencia', re:/\b(confirme|comprove|verifique|evidencias?|fonte confiavel|dados atuais|ultima versao|noticias recentes)\b/,
    guide:'Confronte as alegacoes materiais com evidencias realmente disponiveis. Se faltar verificacao, diga exatamente o que permanece sem confirmar; nao atribua confianca numerica sem calibracao.'},
]);

export function metacognitiveProfile(prompt) {
  const question=normalize(currentMessage(prompt));
  const selected=reviewTriggers.filter(item=>item.re.test(question));
  return {triggers:selected.map(item=>item.id),guidance:selected.map(item=>item.guide)};
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function currentMessage(prompt) {
  const raw = String(prompt ?? '').split('\n\nMensagem atual:\n').at(-1);
  return raw.slice(0, 6000);
}

export function cognitiveProfile(prompt) {
  const question = normalize(currentMessage(prompt));
  // Business numbers and code may require multiple perspectives in one request.
  const matches = domains.filter(item => item.re.test(question)).slice(0, 2);
  const complex = metacognitiveProfile(prompt).triggers.length > 0 || question.length > 420 ||
    /\b(compare|comparar|analise|investigue|investigar|contradicao|decisao|viabilidade|alternativas?|riscos?|problema|por que|causa)\b/.test(question);
  return {
    domains: matches.map(item => item.id),
    depth: complex ? 'analitico' : 'direto',
    guidance: matches.map(item => item.guide),
  };
}

export function cognitiveGuidance(prompt) {
  const profile = cognitiveProfile(prompt);
  const base = 'NUCLEO COGNITIVO 1.6.2: Compreenda o objetivo antes de responder. Observe fatos, identifique premissas e inconsistencias relevantes, considere uma explicacao alternativa quando ela alterar a conclusao e verifique com ferramentas autorizadas quando necessario. Nao invente padroes, intencoes, memórias, resultados ou acesso a fontes. Diferencie fato, hipotese, estimativa e recomendacao. Seja independente: discorde quando a evidencia exigir, nunca por exibicionismo. Conserve o controle do usuario sobre acoes externas, dados e custos. Evite analises longas em conversas casuais.';
  const depth = profile.depth === 'analitico'
    ? 'Para este pedido, avalie a solucao principal contra pelo menos uma alternativa plausivel e explicite as incertezas materiais de forma concisa.'
    : 'Para este pedido, seja natural, direto e proporcional a pergunta.';
  return [base, ...profile.guidance, ...metacognitiveProfile(prompt).guidance, depth].join('\n');
}

// Compacto para a rotina autonoma; nao substitui permissoes, quotas nem verificacoes.
export const autonomousObservation = 'Observe a evidencia disponivel antes de concluir. Considere ao menos uma explicacao alternativa quando pertinente. Diferencie fato, hipotese e risco. Nao invente problemas para gerar atividade, nem transforme recomendacao em permissao de agir.';
