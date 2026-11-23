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
