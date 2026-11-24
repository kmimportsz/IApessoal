import test from 'node:test';
import assert from 'node:assert/strict';
import {selectModel} from './worker.mjs';
import {cognitiveProfile} from './cognitive-core.mjs';

test('roteamento escolhe 120B para analise financeira implicita',()=>{
  const question='Qual o risco dessa precificação para o caixa da empresa?';
  assert.equal(cognitiveProfile(question).domains[0],'negocios');
  assert.equal(selectModel(question,{}).id,'@cf/openai/gpt-oss-120b');
});
test('conversa curta preserva modelo economico',()=>{
  assert.equal(selectModel('Oi, tudo bem?',{}).id,'@cf/openai/gpt-oss-20b');
});
test('override administrativo do modelo sempre prevalece',()=>{
  const force='@cf/openai/gpt-oss-20b';
  assert.equal(selectModel('Analise o risco dessa precificação em detalhes',{MODEL:force}).id,force);
});
test('nucleo nao afirma acesso a ferramentas externas',()=>{
  const profile=cognitiveProfile('Por que houve erro de autenticação nessa API?');
  assert.equal(profile.depth,'analitico');
  assert.ok(profile.domains.includes('engenharia'));
});

test('reconsideracao explicita usa modelo avancado sem ignorar override',()=>{
  const q='Você errou? Tem certeza?';
  assert.equal(selectModel(q,{}).id,'@cf/openai/gpt-oss-120b');
  assert.equal(selectModel(q,{MODEL:'@cf/openai/gpt-oss-20b'}).id,'@cf/openai/gpt-oss-20b');
});
