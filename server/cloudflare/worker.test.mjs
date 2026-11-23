import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker, { selectModel } from './worker.mjs';
import { describe, interpret } from './recovery.mjs';

const token = 'x'.repeat(43);
const sha = value => createHash('sha256').update(value).digest('hex');

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const queued = [];
  let calls = 0;
  const env = {
    OWNER_SHA256: sha(token), DEPLOYMENT_TIER: 'workers-free-confirmed', RECOVERY_KEY: '1'.repeat(64),
    INFERENCE: {send: async body => queued.push(body)},
    DB: {
      prepare(sql) {
        function prepared(params) {
          const statement = db.prepare(sql);
          return {first: async () => statement.get(...params) ?? null, all: async () => ({results: statement.all(...params)}),
            run: async () => statement.run(...params), bind: (...next) => prepared(next)};
        }
        return prepared([]);
      },
      async batch(statements) {
        db.exec('BEGIN');
        try { for (const item of statements) await item.run(); db.exec('COMMIT'); }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
    AI: {run: async (_, payload) => {
      calls++;
      assert.match(payload.messages[0].content, /SQLite/);
      return {choices:[{message:{content:'Resposta de teste'},finish_reason:'stop'}], usage:{prompt_tokens:330, completion_tokens:52}};
    }},
  };
  const call = (path, data, credential = token, signal) => worker.fetch(new Request('https://ipe.test' + path, {
    method: data ? 'POST' : 'GET', headers: {Authorization:'Bearer ' + credential},
    body: data && JSON.stringify(data), signal,
  }), env);
  const job = () => ({id:crypto.randomUUID(), route:'local', prompt:'Mensagem de teste'});
  async function consume(body = queued[0]) {
    await worker.queue({messages:[{body, ack() {}}]}, env);
  }
  return {db, env, call, job, queued, consume, count: () => calls};
}

test('Aceitação, desconexão, processamento e recuperação autenticada sem nova inferência', async t => {
  const {call, job, queued, consume, count, db} = setup(t);
  const message = job();
  const controller = new AbortController();
  const submitted = await call('/chat', message, token, controller.signal);
  assert.equal(submitted.status, 202);
  controller.abort();
  assert.equal((await (await call('/requests/' + message.id)).json()).state, 'processing');
  assert.equal((await call('/chat', message)).status, 202);
  assert.equal(queued.length, 1);
  assert.doesNotMatch(JSON.stringify(queued), /Mensagem de teste/);
  await Promise.all([consume(), consume()]);
  assert.equal(count(), 1);
  assert.equal((await call('/requests/' + message.id, undefined, 'y'.repeat(43))).status, 401);
  const recovered = await (await call('/requests/' + message.id)).json();
  assert.equal(recovered.state, 'finished');
  assert.equal(recovered.reply, 'Resposta de teste');
  assert.equal((await (await call('/chat', message)).json()).reply, recovered.reply);
  const audit = await (await call('/audit')).json();
  assert.equal(audit[0].state, 'finished');
  assert.equal(audit[0].model, '@cf/openai/gpt-oss-20b');
  assert.equal(typeof audit[0].durationMs, 'number');
  assert.doesNotMatch(JSON.stringify(audit), /Resposta de teste|sealed_reply|Mensagem de teste/);
  assert.doesNotMatch(db.prepare('SELECT sealed_reply FROM request_recovery').get().sealed_reply, /Resposta de teste/);
  assert.equal(count(), 1);
});

test('Cota, gateway gratuito e autenticação', async t => {
  const {call, job, queued, count, env} = setup(t);
  assert.equal((await call('/status', undefined, 'y'.repeat(43))).status, 401);
  assert.equal((await (await call('/status')).json()).paid, false);
  assert.equal((await call('/chat', {...job(), route:'paid'})).status, 503);
  const long = 'Analise cenário empresarial. ' + 'ação '.repeat(1100);
  const burst = await Promise.all(Array.from({length:45}, () => call('/chat', {...job(), prompt:long})));
  assert.ok(burst.some(r => r.status === 202));
  assert.ok(burst.some(r => r.status === 402));
  const status = await (await call('/status')).json();
  assert.ok(status.neuronsUsed <= status.neuronLimit);
  assert.equal(status.dailyUsed, queued.length);
  assert.equal(count(), 0);
  env.DEPLOYMENT_TIER = '';
  assert.equal((await call('/chat', job())).status, 503);
});

test('Falha explícita do provedor, código, duração e retenção da reserva', async t => {
  const {call, job, consume, env} = setup(t);
  const message = job();
  env.AI.run = async () => { throw Object.assign(new Error('segredo do provedor'), {status:429}); };
  assert.equal((await call('/chat', message)).status, 202);
  const before = (await (await call('/status')).json()).neuronsUsed;
  await consume();
  const result = await (await call('/requests/' + message.id)).json();
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'provider_rate_limit');
  assert.equal(result.providerCode, '429');
  assert.doesNotMatch(JSON.stringify(result), /segredo/);
  assert.equal((await (await call('/status')).json()).neuronsUsed, before);
});

test('Resposta truncada não é concluída e só o resultado válido expira no Cron', async t => {
  const {call, job, env, db, consume, queued} = setup(t);
  const a = job(), b = job();
  await call('/chat', a);
  await consume();
  await call('/chat', b);
  env.AI.run = async () => ({choices:[{message:{content:'parcial'},finish_reason:'length'}]});
  await consume(queued[1]);
  const failed = await (await call('/requests/' + b.id)).json();
  assert.equal(failed.code, 'output_limit');
  assert.equal(failed.state, 'failed');
  assert.equal(failed.reply, undefined);
  db.prepare('UPDATE request_recovery SET expires=? WHERE id=?').run(Date.now()-1,a.id);
  const expired = await (await call('/requests/' + a.id)).json();
  assert.equal(expired.state, 'finished');
  assert.equal(expired.code, 'response_expired');
  assert.equal(expired.reply, undefined);
  await worker.scheduled({}, env);
  assert.equal(db.prepare('SELECT sealed_reply FROM request_recovery WHERE id=?').get(a.id).sealed_reply, null);
});

test('Ausência de recibo e auditoria histórica não desencadeiam inferência', async t => {
  const {call, job, db, queued} = setup(t);
  const a = job();
  const now = Date.now();
  assert.equal((await call('/requests/' + a.id)).status, 404);
  db.prepare("INSERT INTO ai_calls_v12 VALUES (?,?,?,?,?,?,?)").run(a.id,'2020-01-01','2020-01',now-360001,'started','modelo',42);
  const receipt = await (await call('/requests/' + a.id)).json();
  assert.equal(receipt.state, 'unknown');
  assert.equal(receipt.code, 'no_terminal_confirmation');
  assert.equal((await call('/chat', a)).status, 200);
  assert.equal(queued.length, 0);
  assert.equal(describe({legacy:'finished', created:now},now).code, 'legacy_response_not_retained');
});

test('Entrada complexa mantém 120B e o gateway distingue resposta vazia de truncada', async t => {
  const {call, job, consume, env} = setup(t);
  const a = {...job(), prompt:'Analise um cenário empresarial em cinco etapas. ' + 'premissa sujeita a validação '.repeat(120)};
  await call('/chat', a);
  env.AI.run = async (model, payload) => {
    assert.equal(model, '@cf/openai/gpt-oss-120b');
    assert.equal(payload.max_tokens, 4096);
    assert.equal(payload.messages.at(-1).content, a.prompt);
    return {choices:[{message:{content:'Análise completa'},finish_reason:'stop'}]};
  };
  await consume();
  assert.equal((await (await call('/requests/' + a.id)).json()).reply, 'Análise completa');
  assert.equal(selectModel('oi', {}).label, 'GPT-OSS 20B');
  assert.equal(interpret({response:''}).code, 'empty_response');
});

test('Requisição temporalmente incerta pode ser consultada após uma entrada na fila sem confirmação', async t => {
  const {call, job, queued, consume, env, count} = setup(t);
  const a = job();
  env.INFERENCE.send = async body => {
    queued.push(body);
    throw Error('A confirmação da fila se perdeu');
  };
  assert.equal((await call('/chat', a)).status, 502);
  assert.equal((await call('/chat', a)).status, 202);
  assert.equal(queued.length, 1);
  await consume();
  assert.equal((await (await call('/requests/' + a.id)).json()).state, 'finished');
  assert.equal(count(), 1);
});

test('Cem tentativas bloqueiam novas inferências mesmo com Neurons sobrando', async t => {
  const {call, job, db, queued} = setup(t);
  const now = new Date();
  const day = now.toISOString().slice(0,10);
  const insert = db.prepare("INSERT INTO ai_calls_v12 VALUES (?,?,?,?,'finished','modelo',1)");
  for (let i = 0; i < 100; i++) insert.run(crypto.randomUUID(),day,day.slice(0,7),now.getTime());
  assert.equal((await call('/chat', job())).status, 402);
  assert.equal(queued.length, 0);
});

test('Objetivos exigem autorização e o agendamento gera um único evento verificável', async t => {
  const {call, env, count, db, queued} = setup(t);
  const id=crypto.randomUUID();
  const due=Date.now()+60_000;
  const project={id,title:'Projeto de teste',pending:'Conferir números de referência',due};
  assert.equal((await call('/initiative/projects',project)).status,409);
  assert.equal((await call('/initiative/permission',{enabled:true},'y'.repeat(43))).status,401);
  assert.equal((await call('/initiative/permission',{enabled:true})).status,200);
  assert.equal((await call('/initiative/projects',project)).status,201);
  assert.deepEqual(queued[0],{kind:'initiative_review'});
  await worker.scheduled({},env);
  assert.equal((await (await call('/initiative')).json()).initiatives.length,0);
  db.prepare('UPDATE tracked_projects SET due=? WHERE id=?').run(Date.now()-20,id);
  await call('/initiative/permission',{enabled:false});
  await worker.scheduled({},env);
  assert.equal((await (await call('/initiative')).json()).initiatives.length,0);
  await call('/initiative/permission',{enabled:true});
  await worker.queue({messages:[{body:queued[0],ack(){}}]},env);
  await worker.scheduled({},env);
  const events=(await (await call('/initiative')).json()).initiatives;
  assert.equal(events.length,1);
  assert.equal(events[0].id,id);
  assert.equal(events[0].origin,'revisão agendada');
  assert.equal(count(),0);
});
