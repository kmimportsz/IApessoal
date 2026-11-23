import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker from './worker.mjs';
import { selectModel } from './worker.mjs';

const token = 'x'.repeat(43);
const ownerHash = createHash('sha256').update(token).digest('hex');

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  let calls = 0;
  const env = {
    OWNER_SHA256: ownerHash, DEPLOYMENT_TIER: 'workers-free-confirmed',
    DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        return {
          bind(...params) {
            return {
              first: async () => statement.get(...params) ?? null,
              run: async () => statement.run(...params),
            };
          },
          all: async () => ({results: statement.all()}),
          first: async () => statement.get() ?? null,
        };
      },
    },
    AI: {run: async (model, input) => {
      calls++;
      assert.match(input.messages[0].content, new RegExp(model));
      assert.match(input.messages[0].content, /SQLite/);
      assert.equal(input.messages[1].role, 'user');
      return {response: '<think>interno</think> Resposta de teste', usage: {prompt_tokens: 330, completion_tokens: 52}};
    }},
  };
  const call = (path, data, credential = token) => worker.fetch(new Request('https://ipe.test' + path, {
    method: data && 'POST' || 'GET',
    headers: {Authorization: 'Bearer ' + credential},
    body: data && JSON.stringify(data),
  }), env);
  const job = (id = crypto.randomUUID(), route = 'local') => ({id, route, prompt: 'Mensagem de teste'});
  return {env, call, job, count: () => calls};
}

test('Contrato compatível com app, autenticação e bloqueio de rota paga', async t => {
  const {env, call, job, count} = setup(t);
  assert.equal((await call('/status', undefined, 'x'.repeat(42) + 'y')).status, 401);
  const status = await (await call('/status')).json();
  assert.equal(status.local, true);
  assert.equal(status.paid, false);
  assert.equal(status.limit, 2000);
  assert.equal((await call('/chat', job(undefined, 'paid'))).status, 503);
  assert.equal(count(), 0);
  env.DEPLOYMENT_TIER = '';
  assert.equal((await call('/chat', job())).status, 503);
  assert.equal(count(), 0);
});

test('Deduplicação concorrente, limite diário e auditoria sem conteúdo', async t => {
  const {call, job, count} = setup(t);
  const first = job();
  const results = await Promise.all([call('/chat', first), call('/chat', first)]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  const reply = await results.find(x => x.status === 200).json();
  assert.equal(reply.reply, 'Resposta de teste');
  assert.equal(reply.model, '@cf/openai/gpt-oss-20b');
  const burst = await Promise.all(Array.from({length: 105}, () => call('/chat', job())));
  assert.equal(burst.filter(x => x.status === 200).length, 99);
  assert.equal(burst.filter(x => x.status === 402).length, 6);
  assert.equal(count(), 100);
  const audit = await (await call('/audit')).json();
  assert.equal(audit.length, 50);
  assert.equal(audit.every(row => row.state === 'finished'), true);
  assert.equal(JSON.stringify(audit).includes(first.prompt), false);
});

test('Falha incerta mantém a reserva, sem nova inferência com o mesmo ID', async t => {
  const {call, job, env} = setup(t);
  let calls = 0;
  env.AI.run = async () => { calls++; throw new Error('provider failed'); };
  const first = job();
  assert.equal((await call('/chat', first)).status, 502);
  assert.equal((await call('/chat', first)).status, 409);
  const audit = await (await call('/audit')).json();
  assert.equal(audit[0].state, 'uncertain');
  assert.equal(calls, 1);
});

test('Pareamento é único, substitui a credencial temporária e mantém só o hash', async t => {
  const {call, env} = setup(t);
  const code = 'z'.repeat(43);
  env.PAIR_SHA256 = createHash('sha256').update(code).digest('hex');
  env.PAIR_UNTIL = String(Date.now() + 60_000);
  const exchange = origin => worker.fetch(new Request('https://ipe.test/pair', {
    method: 'POST', headers: {Origin: origin}, body: JSON.stringify({code}),
  }), env);
  assert.equal((await exchange('https://outro.test')).status, 403);
  const pair = await exchange('https://ipe.test');
  assert.equal(pair.status, 201);
  const {token: newToken} = await pair.json();
  assert.match(newToken, /^[a-f0-9]{64}$/);
  assert.equal((await call('/status')).status, 401);
  assert.equal((await call('/status', undefined, newToken)).status, 200);
  assert.equal((await exchange('https://ipe.test')).status, 409);
  const stored = await env.DB.prepare('SELECT token_hash FROM gateway_owner WHERE singleton=1').first();
  assert.equal(stored.token_hash, createHash('sha256').update(newToken).digest('hex'));
});

test('Roteamento pesa a mensagem atual, respeita configuração e fixa a identidade do modelo', () => {
  assert.equal(selectModel('oi', {}).label, 'GPT-OSS 20B');
  assert.equal(selectModel('Compare duas estratégias de aprendizagem.', {}).label, 'GPT-OSS 120B');
  assert.equal(selectModel('Contexto escolhido pelo usuário:\narquitetura\n\nMensagem atual:\nOi', {}).label, 'GPT-OSS 20B');
  assert.equal(selectModel('oi', {MODEL: '@cf/openai/gpt-oss-120b'}).label, 'GPT-OSS 120B');
  assert.equal(selectModel('oi', {MODEL: 'não cadastrado'}), null);
});

test('Reserva de Neurons bloqueia mensagens longas antes do limite de tentativas', async t => {
  const {call, job, env} = setup(t);
  env.AI.run = async () => { throw Error('sem confirmação'); };
  const huge = 'analisar ' + 'ação '.repeat(1150);
  const burst = await Promise.all(Array.from({length: 45}, () => call('/chat', {...job(), prompt: huge})));
  assert.ok(burst.some(result => result.status === 502));
  assert.ok(burst.some(result => result.status === 402));
  const status = await (await call('/status')).json();
  assert.ok(status.neuronsUsed <= status.neuronLimit);
  assert.ok(status.dailyUsed < status.dailyLimit);
});

test('A ficha oficial explica a persistência e informa a seleção prevista sem inferência', async t => {
  const {call, job, count} = setup(t);
  const actual = await (await call('/chat', {...job(), prompt: 'Qual é seu nome, modelo e como funciona sua memória?'})).json();
  assert.equal(actual.responseSource, 'gateway-identity');
  assert.equal(actual.model, null);
  assert.equal(count(), 0);
  assert.match(actual.reply, /GPT-OSS 20B/);
  assert.match(actual.reply, /SQLite/);
  assert.match(actual.reply, /contexto que você aprovar/);
});
