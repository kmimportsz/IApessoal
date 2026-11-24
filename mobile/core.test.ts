import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionState, eligible, endpoint, experiment, matches, memoryKey, messageForQueue, preferenceCandidate, relevantMemory } from './core.ts';

test('Busca tolera acentos e ordem na versão candidata', () => {
  assert.equal(matches('Ação planejada para amanhã', 'amanha acao', 2), true);
  assert.equal(matches('Ação planejada para amanhã', 'amanha acao', 1), false);
  assert.equal(matches('Ação planejada', 'acao janeiro', 2), false);
});

test('Critério de ativação usa resultados executados', () => {
  const result = experiment();
  assert.deepEqual(result.versions.map(version => version.passed), [3, 6]);
  assert.equal(eligible(result), true);
  result.versions[1].passed -= 1;
  assert.equal(eligible(result), false);
});

test('Somente gateway HTTPS sem segredos na URL', () => {
  assert.equal(endpoint('https://ipe.example/'), 'https://ipe.example');
  for (const url of ['http://ipe.example', 'https://secret@ipe.example', 'https://ipe.example/?key=token']) {
    assert.throws(() => endpoint(url));
  }
});

test('Disponibilidade distingue ausência de rede, credencial e rota desativada', () => {
  assert.equal(connectionState(true, false, 200, true), 'offline');
  assert.equal(connectionState(false, true, undefined), 'unconfigured');
  assert.equal(connectionState(true, true, undefined), 'checking');
  assert.equal(connectionState(true, true, 401), 'auth');
  assert.equal(connectionState(true, true, 0), 'unreachable');
  assert.equal(connectionState(true, true, 200, false), 'disabled');
  assert.equal(connectionState(true, true, 200, true), 'online');
});

test('A sugestão de memória exige preferência explícita e passa por filtro básico', () => {
  assert.equal(preferenceCandidate('  Prefiro respostas curtas. '), 'Prefiro respostas curtas.');
  for (const text of ['Eu gosto de café', 'Prefiro a senha azul', 'Prefiro ana@exemplo.com', 'Prefiro 1234']) {
    assert.equal(preferenceCandidate(text), undefined);
  }
});

test('O texto marcado como contexto aparece explicitamente na mensagem enfileirada', () => {
  assert.equal(messageForQueue('  Olá  ', ''), 'Olá');
  assert.equal(messageForQueue('  Olá ', 'Conversa anterior'), 'Contexto escolhido pelo usuário:\nConversa anterior\n\nMensagem atual:\nOlá');
});

test('Recuperação local escolhe informação pertinente e exclui conteúdo privado', () => {
  const shared = {id:'1', body:'O roteiro Aurora usa a etiqueta violeta nos arquivos.', kind:'Projeto' as const, private:0, version:1, updated:1};
  const hidden = {...shared, id:'2', private:1, updated:2};
  assert.equal(relevantMemory('Qual a etiqueta do roteiro Aurora?', [hidden, shared])?.id, '1');
  assert.equal(relevantMemory('Qual a etiqueta do roteiro Aurora?', [hidden]), undefined);
  assert.equal(relevantMemory('Oi', [shared]), undefined);
  assert.equal(memoryKey(' AÇÃO,  nova! '), memoryKey('acao nova'));
});

test('Continuação sugere só uma troca recente e não herda memória vinculada', async () => {
  const {recentContext} = await import('./core.ts');
  const previous={prompt:'Um projeto de teste',reply:'Resposta anterior',memory_id:null,reply_at:10000};
  assert.match(recentContext('E se mudar?',previous,20000) ?? '', /Resposta anterior/);
  assert.equal(recentContext('Outro tema',previous,20000),undefined);
  assert.equal(recentContext('Continue',{...previous,memory_id:'privada'},20000),undefined);
  assert.equal(recentContext('Continue',{...previous,prompt:'Contexto escolhido pelo usuário: teste'},20000),undefined);
  assert.equal(recentContext('Continue',previous,4000000),undefined);
});

test('Validação do backup separa dados aceitos de credenciais, IDs externos e formatos inválidos', async () => {
  const {validateMemoryBackup}=await import('./core.ts');
  const valid={id:'remoto',kind:'Projeto',body:'Projeto local',private:1,updated:20,version:15,token:'segredo'};
  const [row]=validateMemoryBackup({version:1,memories:[valid]});
  assert.deepEqual(row,{id:'',kind:'Projeto',body:'Projeto local',private:1,updated:20,version:1});
  assert.throws(()=>validateMemoryBackup({version:2,memories:[]}));
  assert.throws(()=>validateMemoryBackup({version:1,memories:[{...valid,private:'yes'}]}));
});

test('Pesquisa automática extrai tema público e rejeita menções pessoais e texto misturado', async ()=>{
  const {publicResearchTopic}=await import('./core.ts');
  assert.equal(publicResearchTopic('Pesquise sobre energia solar'),'energia solar');
  assert.equal(publicResearchTopic('Pesquise minha conta corrente'),undefined);
  assert.equal(publicResearchTopic('Pesquise informações de teste@exemplo.org'),undefined);
  assert.equal(publicResearchTopic('Bom dia, como vai?'),undefined);
});

test('Backup integrado preserva histórico e filtra opções secretas',async()=>{
  const {validateWorkspace}=await import('./backup-format.ts');
  const {validateMemoryBackup}=await import('./core.ts');
  const result=validateWorkspace({version:2,threads:[{id:'principal',title:'Principal',archived:0}],messages:[],
    cloud:null,memories:[],options:{profileName:'Nome',token:'segredo',avatarPhoto:'arquivo'}},validateMemoryBackup);
  assert.deepEqual(result.options,{profileName:'Nome'});
  assert.equal(result.threads[0].id,'principal');
});

test('Aprendizado só propõe declarações explícitas do usuário, nunca grava ou autoriza',async()=>{
 const {learningCandidate}=await import('./core.ts');
 assert.deepEqual(learningCandidate('Aprendi que devo validar o estoque antes de publicar.'),{kind:'Aprendizado',body:'Aprendi que devo validar o estoque antes de publicar.'});
 assert.equal(learningCandidate('Decidi que o catálogo Aurora continuará azul.')?.kind,'Decisão');
 assert.equal(learningCandidate('Meu objetivo é reduzir o retrabalho.')?.kind,'Objetivo');
 assert.equal(learningCandidate('O erro foi publicar sem teste.')?.kind,'Erro e solução');
 assert.equal(learningCandidate('Aprendi que minha senha é exemplo.'),undefined);
 assert.equal(learningCandidate('Decidi que meu token é secreto.'),undefined);
 assert.equal(learningCandidate('A IA disse que aprendi que isso funciona.'),undefined);
});
