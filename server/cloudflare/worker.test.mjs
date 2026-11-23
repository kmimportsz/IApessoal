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

test('Calculadora usa racionais exatos e rejeita entrada executável', async () => {
  const {calculate}=await import('./calculator.mjs');
  assert.deepEqual(calculate('(0,1 + 0,2) * 100%'), {expression:'(0.1+0.2)*100%',exact:'3/10',decimal:'0,3',rounded:false});
  assert.equal(calculate('1/3').exact,'1/3');
  assert.throws(()=>calculate('1/0'));
  assert.throws(()=>calculate('1; fetch("https://example.test")'));
});

test('Pesquisa é uma consulta fixa e a resposta só contém links reconstruídos da fonte', async () => {
  const {searchPublic}=await import('./research.mjs');
  const data=await searchPublic('energia solar',async url=>{
    assert.equal(url.hostname,'pt.wikipedia.org');
    assert.equal(url.searchParams.get('q'),'energia solar');
    return Response.json({pages:[{key:'Energia_solar',title:'Energia solar',url:'https://example.test',description:'<b>Fonte</b>'}]});
  });
  assert.deepEqual(data.results,[{title:'Energia solar',url:'https://pt.wikipedia.org/wiki/Energia_solar',description:'Fonte',date:null,source:'Wikipédia'}]);
  assert.equal(data.providers.filter(provider=>provider.available).length,1);
});

test('Plano semanal gera um único evento por ciclo e pausa suspende novas revisões', async t => {
  const {call, env, db}=setup(t);
  const id=crypto.randomUUID();
  const day=86400000, due=Date.now()+60000;
  await call('/initiative/permission',{enabled:true});
  assert.equal((await call('/initiative/projects',{id,title:'Projeto',pending:'Teste',due})).status,201);
  const details={id,description:'descrição',objective:'meta',priority:'high',status:'active',frequencyDays:7};
  assert.equal((await call('/initiative/details',details)).status,200);
  db.prepare('UPDATE tracked_projects SET due=? WHERE id=?').run(Date.now()-8*day,id);
  await worker.scheduled({},env);await worker.scheduled({},env);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recurring_reviews_v14').get().n,1);
  assert.equal((await call('/initiative/details',{...details,status:'paused'})).status,200);
  assert.equal(db.prepare('SELECT active FROM tracked_projects WHERE id=?').get(id).active,0);
  db.prepare('UPDATE tracked_projects SET due=? WHERE id=?').run(Date.now()-15*day,id);
  await worker.scheduled({},env);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recurring_reviews_v14').get().n,1);
});

test('O modelo pode pedir somente a calculadora autorizada e o recibo entrega o resultado verificado', async t => {
  const {call,env,db,consume,job}=setup(t);
  const a={...job(),prompt:'Calcule (80 - 45) * 60'};
  await call('/chat',a);
  env.AI.run=async (_,input)=>{
    assert.equal(input.tools[0].function.name,'calculate');
    return {choices:[{message:{tool_calls:[{function:{name:'calculate',arguments:JSON.stringify({expression:'(80-45)*60'})}}]},finish_reason:'tool_calls'}]};
  };
  await consume();
  const result=await (await call('/requests/'+a.id)).json();
  assert.equal(result.state,'finished');
  assert.match(result.reply,/2100/);
  assert.equal(db.prepare('SELECT outcome FROM tool_audit_v14 WHERE id=?').get(a.id).outcome,'verified');
  assert.equal((await call('/research',{query:'tema público'})).status,400);
});

test('Automação agenda somente projetos autorizados e faz no máximo uma inferência por evento', async t=>{
  const {db,env,call}=setup(t);
  const id=crypto.randomUUID(),future=Date.now()+60000;
  await call('/initiative/permission',{enabled:true});
  await call('/initiative/projects',{id,title:'Loja',pending:'Comparar duas propostas',due:future});
  db.prepare('UPDATE tracked_projects SET due=? WHERE id=?').run(Date.now()-50,id);
  await worker.scheduled({},env);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_analysis_v15').get().n,0);
  await call('/automation/project',{id,enabled:true});
  db.prepare('UPDATE initiative_events SET occurred=? WHERE project_id=?').run(Date.now()+20,id);
  let calls=0;
  env.AI.run=async (_,data)=>{
    calls++;
    assert.match(data.messages[1].content,/Comparar duas propostas/);
    return {choices:[{message:{content:JSON.stringify({relevant:true,summary:'Compare custo total.',action:'Peça dois orçamentos.'})},finish_reason:'stop'}]};
  };
  await Promise.all([worker.scheduled({},env),worker.scheduled({},env)]);
  assert.equal(calls,1);
  const receipt=await (await call('/automation')).json();
  assert.equal(receipt.entries[0].state,'ready');
  assert.equal(receipt.entries[0].action,'Peça dois orçamentos.');
  assert.doesNotMatch(db.prepare('SELECT sealed FROM project_analysis_v15').get().sealed,/orçamentos/);
});

test('Consulta financeira usa o modelo avançado e porcentagem clara é determinística', async t=>{
  const {call,job,queued}=setup(t);
  assert.equal(selectModel('É realista obter R$ 100 mil começando com R$ 500?',{}).label,'GPT-OSS 120B');
  const response=await (await call('/chat',{...job(),prompt:'Quanto é 18% de R$ 3.450?'})).json();
  assert.equal(response.modelLabel,'Calculadora');
  assert.match(response.reply,/621/);
  assert.equal(queued.length,0);
});

test('Backup remoto ignora projetos duplicados e nunca reativa a agenda importada', async t=>{
  const {call,db}=setup(t);
  const id=crypto.randomUUID(),now=Date.now();
  const data={confirmed:true,projects:[{id,title:'Importado',pending:'Avaliar',due:now}],events:[{id,cycle:0,due:now,occurred:now,state:'new'}]};
  assert.equal((await call('/backup/projects',{...data,confirmed:false})).status,400);
  const first=await (await call('/backup/projects',data)).json();
  assert.equal(first.imported,1);
  const second=await (await call('/backup/projects',data)).json();
  assert.equal(second.imported,0);
  assert.equal(db.prepare('SELECT active FROM tracked_projects WHERE id=?').get(id).active,0);
  assert.equal(db.prepare('SELECT state FROM initiative_events WHERE project_id=?').get(id).state,'read');
});

test('GitHub exige autorização, verifica webhook e analisa arquivo real do transporte simulado', async t=>{
  const {db,env,call}=setup(t);
  const {exportKey}=await import('node:crypto').then(c=>({exportKey:()=>c.generateKeyPairSync('rsa',{modulusLength:2048})
    .privateKey.export({type:'pkcs8',format:'pem'})}));
  Object.assign(env,{GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',GITHUB_PRIVATE_KEY:exportKey(),
    GITHUB_WEBHOOK_SECRET:'segredo de teste'});
  const commit='a'.repeat(40), tree='b'.repeat(40);
  const list={id:12,full_name:'owner/repo',description:'Privado',private:true};
  t.mock.method(globalThis,'fetch',async (address, options)=>{
    const {hostname,pathname,searchParams}=new URL(address);
    assert.equal(hostname,'api.github.com');
    assert.equal(options.redirect,'error');
    const out={
      '/installation/repositories':{repositories:[list]},
      '/repos/owner/repo':{...list,default_branch:'main'},
      '/repos/owner/repo/commits/main':{sha:commit,files:[{filename:'src/index.js'}],commit:{tree:{sha:tree}}},
      ['/repos/owner/repo/git/trees/'+tree]:{tree:[]},
      '/repos/owner/repo/contents/src/index.js':{encoding:'base64',type:'file',size:37,content:btoa('export const label = input.value;')},
      '/repos/owner/repo/issues':[],
    };
    if(options.method==='POST'){
      assert.equal(pathname,'/app/installations/456/access_tokens');
      const payload=JSON.parse(options.body);
      if(payload.repository_ids) assert.deepEqual(payload.repository_ids,[12]);
      assert.ok(Object.values(payload.permissions).every(value=>value==='read'));
      return Response.json({token:'fake-installation-token'});
    }
    if(pathname.includes('/contents/')) assert.equal(searchParams.get('ref'),commit);
    assert.ok(Object.hasOwn(out,pathname),pathname);
    return Response.json(out[pathname]);
  });
  let inferences=0;
  env.AI.run=async (_,payload)=>{
    inferences++;
    assert.match(payload.messages[1].content,/export const label = input.value/);
    const finding={path:'src/index.js',line:1,priority:'média',confidence:'média',problem:'Entrada pode faltar.',
      impact:'Renderização interrompida.',suggestion:'Valide antes de ler o valor.'};
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({finding})}}]};
  };
  assert.equal((await call('/github/installations',undefined,'z'.repeat(43))).status,401);
  assert.equal((await call('/github/repository',{id:13,state:'active'})).status,404);
  assert.equal((await call('/github/repository',{id:12,state:'active'})).status,200);
  await Promise.all([worker.scheduled({},env),worker.scheduled({},env)]);
  assert.equal(inferences,1);
  const status=await (await call('/github')).json();
  assert.equal(status.history[0].finding.excerpt,'export const label = input.value;');
  assert.equal(status.history[0].commit_sha,commit);
  assert.doesNotMatch(db.prepare('SELECT sealed FROM github_runs_v15').get().sealed,/Entrada|input.value/);
  await call('/github/finding',{id:status.history[0].finding_id,state:'resolved'});
  assert.equal((await (await call('/github')).json()).history[0].finding_state,'resolved');

  const body=JSON.stringify({installation:{id:456},repository:{id:12,default_branch:'main'},ref:'refs/heads/main'});
  const {createHmac}=await import('node:crypto');
  const signature='sha256='+createHmac('sha256',env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex');
  const delivery=crypto.randomUUID();
  const webhook = (sig,event='push')=>worker.fetch(new Request('https://ipe.test/github/webhook',{
    method:'POST',body,headers:{'X-Hub-Signature-256':sig,'X-GitHub-Delivery':delivery,'X-GitHub-Event':event},
  }),env);
  assert.equal((await webhook('sha256='+'0'.repeat(64))).status,401);
  assert.equal((await webhook(signature)).status,200);
  assert.equal((await webhook(signature)).status,200);
  assert.equal(db.prepare('SELECT revision FROM github_repos_v15').get().revision,1);
  await call('/github/repository',{id:12,state:'paused'});
  await worker.scheduled({},env);
  assert.equal(inferences,1);
  await call('/github/repository',{id:12,state:'disconnected'});
  assert.equal((await (await call('/github')).json()).history.length,0);
});

test('Uma descoberta jamais pode citar arquivo ou linha ausente do material',async ()=>{
  const {evidence}=await import('./github.mjs');
  const f={path:'file.js',line:2,priority:'alta',confidence:'baixa',problem:'x',impact:'y',suggestion:'z'};
  assert.throws(()=>evidence({response:JSON.stringify({finding:f})},[{path:'file.js',lines:['linha 1']}]),/Evidência inválida/);
});
