import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligible, endpoint, experiment, matches } from './core.ts';

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
