import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
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
    assert.match(data.messages[0].content,/nao diga que o projeto esta finalizado/);
    return {choices:[{message:{content:JSON.stringify({relevant:true,summary:'Compare custo total.',action:'Peça dois orçamentos.'})},finish_reason:'stop'}]};
  };
  await Promise.all([worker.scheduled({},env),worker.scheduled({},env)]);
  assert.equal(calls,1);
  const receipt=await (await call('/automation')).json();
  assert.equal(receipt.entries[0].state,'ready');
  assert.equal(receipt.entries[0].action,'Peça dois orçamentos.');
  assert.equal((await call('/excellence/project/'+id,undefined,'z'.repeat(43))).status,401);
  const director=await (await call('/excellence/project/'+id)).json();
  assert.equal(director.gate.approved,false);
  assert.equal(director.analysisState,'ready');
  assert.equal(calls,1);
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
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  Object.assign(env,{GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',
    GITHUB_PRIVATE_KEY:privateKey.export({type:'pkcs1',format:'pem'}).replace(/\n/g,'\r\n'),
    GITHUB_WEBHOOK_SECRET:'segredo de teste'});
  let commit='a'.repeat(40);
  const tree='b'.repeat(40);
  const list={id:12,full_name:'owner/repo',description:'Privado',private:true};
  let redirectOutsideGitHub=false;
  t.mock.method(globalThis,'fetch',async (address, options)=>{
    const {hostname,pathname,searchParams}=new URL(address);
    assert.equal(hostname,'api.github.com');
    assert.equal(options.redirect,'manual');
    const out={
      '/installation/repositories':{repositories:[list],total_count:1},
      '/repos/owner/repo':{...list,default_branch:'main'},
      '/repos/owner/repo/commits/main':{sha:commit,files:[{filename:'src/index.js'}],commit:{tree:{sha:tree}}},
      ['/repos/owner/repo/git/trees/'+tree]:{tree:[]},
      '/repos/owner/repo/contents/src/index.js':{encoding:'base64',type:'file',size:37,content:btoa('export const label = input.value;')},
      '/repos/owner/repo/issues':[],
    };
    if(options.method==='POST'){
      assert.equal(pathname,'/app/installations/456/access_tokens');
      if(redirectOutsideGitHub)return new Response(null,{status:307,headers:{Location:'https://example.org/token'}});
      if(!searchParams.has('canonical'))return new Response(null,{status:307,headers:{Location:pathname+'?canonical=1'}});
      const [header,claims,signature]=options.headers.Authorization.slice('Bearer '.length).split('.');
      assert.ok(verify('RSA-SHA256',Buffer.from(header+'.'+claims),publicKey,Buffer.from(signature,'base64url')));
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
    return {response:{finding},usage:{prompt_tokens:100,completion_tokens:100}};
  };
  assert.equal((await call('/github/installations',undefined,'z'.repeat(43))).status,401);
  assert.equal((await call('/github/repository',{id:13,state:'active'})).status,404);
  await Promise.all([worker.scheduled({},env),worker.scheduled({},env)]);
  assert.equal(inferences,1);
  const status=await (await call('/github')).json();
  assert.equal(status.history[0].finding.excerpt,'export const label = input.value;');
  assert.equal(status.history[0].commit_sha,commit);
  assert.deepEqual(status.history[0].summary.files,[{path:'src/index.js',lines:1,role:'Implementação'}]);
  assert.equal(status.history[0].summary.discoveryCount,1);
  assert.equal((await (await call('/github/dashboard')).json()).files,1);
  assert.equal((await (await call('/github/findings/0')).json()).history.length,1);
  const oldId=crypto.randomUUID();
  db.prepare("INSERT INTO github_runs_v15 VALUES (?,?,?,?,'reviewed',NULL)").run(oldId,12,commit,1);
  const history=await (await call('/github/repository/12/history')).json();
  assert.deepEqual(history.history.find(run=>run.id===oldId).summary,{files:null,failedFiles:null,discoveryCount:0});
  assert.equal(inferences,1);
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
  env.GITHUB_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'});
  assert.equal((await call('/github/installations')).status,200);
  redirectOutsideGitHub=true;
  const callsBefore=fetch.mock.callCount();
  assert.equal((await call('/github/installations')).status,502);
  assert.equal(fetch.mock.callCount(),callsBefore+1);
  redirectOutsideGitHub=false;
  await call('/github/repository',{id:12,state:'paused'});
  await worker.scheduled({},env);
  assert.equal(inferences,1);
  await call('/github/repository',{id:12,state:'disconnected'});
  assert.equal((await (await call('/github')).json()).history.length,0);
  await call('/github/repository',{id:12,state:'active'});
  commit='c'.repeat(40);
  env.AI.run=async()=>({response:{finding:null}});
  await worker.scheduled({},env);
  const noFinding=(await (await call('/github/repository/12/history')).json()).history.find(run=>run.id!==oldId&&run.state==='reviewed');
  assert.deepEqual(noFinding.summary.files,[{path:'src/index.js',lines:1,role:'Implementação'}]);
  assert.equal(noFinding.summary.discoveryCount,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM github_coverage_v16').get().n,2);
});

test('Uma descoberta jamais pode citar arquivo ou linha ausente do material',async ()=>{
  const {evidence}=await import('./github.mjs');
  const f={path:'file.js',line:2,priority:'alta',confidence:'baixa',problem:'x',impact:'y',suggestion:'z'};
  assert.throws(()=>evidence({response:JSON.stringify({finding:f})},[{path:'file.js',lines:['linha 1']}]),/Evidência inválida/);
});


test('Inventário global pagina, preserva pausas e reconhece novos, arquivados e removidos',async t=>{
  const {db,env,call}=setup(t);
  const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
  Object.assign(env,{GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',GITHUB_PRIVATE_KEY:privateKey,GITHUB_WEBHOOK_SECRET:'teste'});
  const {syncGitHubInventory}=await import('./github.mjs');
  let inventory=Array.from({length:53},(_,i)=>({id:i+1,full_name:'owner/repo-'+(i+1),private:i===52}));
  let fail=false;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    if(options.method==='POST')return Response.json({token:'fake'});
    if(fail)return new Response(null,{status:503});
    const page=Number(new URL(url).searchParams.get('page'));
    return Response.json({total_count:inventory.length,repositories:inventory.slice((page-1)*50,page*50)});
  });
  await syncGitHubInventory(env,Date.now());
  const first=await (await call('/github')).json();
  assert.equal(first.repos.length,50);
  assert.equal(first.account.lastSync,null);
  await syncGitHubInventory(env,Date.now());
  assert.equal((await (await call('/github')).json()).repos.length,53);
  await call('/github/repository',{id:2,state:'paused'});
  await call('/github/account',{action:'paused'});
  inventory=inventory.filter(v=>v.id!==1).map(v=>v.id===3?{...v,archived:true}:v);
  inventory.push({id:54,full_name:'owner/new'});
  await syncGitHubInventory(env,Date.now());
  assert.equal(db.prepare('SELECT availability FROM github_inventory_v15 WHERE repo=1').get().availability,'available');
  fail=true;
  await syncGitHubInventory(env,Date.now());
  assert.equal(db.prepare('SELECT availability FROM github_inventory_v15 WHERE repo=1').get().availability,'available');
  assert.equal((await (await call('/github')).json()).account.syncError,true);
  fail=false;
  await call('/github/account',{action:'sync'});
  await syncGitHubInventory(env,Date.now());
  const status=await (await call('/github')).json();
  assert.equal(status.account.state,'paused');
  assert.equal(status.repos.find(v=>v.id===1).availability,'removed');
  assert.equal(status.repos.find(v=>v.id===2).state,'paused');
  assert.equal(status.repos.find(v=>v.id===3).availability,'archived');
  assert.equal(status.repos.find(v=>v.id===53).private,1);
  assert.equal(status.repos.find(v=>v.id===54).state,'active');
  await call('/github/account',{action:'disconnected'});
  await syncGitHubInventory(env,Date.now());
  assert.equal((await (await call('/github')).json()).repos.length,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM github_inventory_v15').get().n,54);
});

test('Cobertura escolhe alterações e avança para novos arquivos no mesmo commit',async ()=>{
  const {selectFiles,potentialFixes}=await import('./github-context.mjs');
  const paths=['src/auth.ts','src/storage.ts','src/ui.tsx'];
  const covered=new Map([['src/auth.ts','current']]);
  const result=selectFiles({paths,covered,sha:'current',changed:new Set(['src/storage.ts']),previous:new Set()});
  assert.deepEqual(result,['src/storage.ts','src/ui.tsx']);
  const previous=[{id:'prior',commit:'old',path:'src/auth.ts',line:1,excerpt:'return old;'}];
  assert.deepEqual(potentialFixes(previous,[{path:'src/auth.ts',lines:['return next;']}],'current'),
    [{id:'prior',path:'src/auth.ts',line:1}]);
  assert.deepEqual(potentialFixes(previous,[{path:'src/auth.ts',lines:['// moved','return old;']}],'current'),[]);
});

test('NEXUS: issue e PR vinculados ao SHA, revisão de UX bloqueante e reavaliação com novo commit', async t=>{
  const {env,db,call,count}=setup(t);
  const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
  Object.assign(env,{GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',GITHUB_PRIVATE_KEY:key.export({type:'pkcs8',format:'pem'}),
    GITHUB_WEBHOOK_SECRET:'test'});
  db.exec(`INSERT INTO github_repos_v15(id,name,description,state,due)VALUES(12,'owner/repo','','active',0);
    INSERT INTO github_inventory_v15 VALUES(12,'456','test','available',0);
    INSERT INTO github_account_v15(singleton,installation,state,next_sync)VALUES(1,'456','active',0);`);
  const id='abcdefab-1234-4abc-8def-abcdefabcdef';
  let markerId=id.toUpperCase();
  let commit='a'.repeat(40), branch='nexus-test', ci='success', modelCalls=0;
  env.AI.run=async(_,payload)=>{
    modelCalls++;
    assert.match(payload.messages[1].content,/src\/cadastro\.test\.ts/);
    return {response:{observations:[{path:'src/cadastro.ts',line:1,problem:'Estado fixo pode esconder erro.',
      verification:'Verifique entradas diferentes.'},{path:'inventado.ts',line:999,problem:'Inventado',verification:'Ignorar'}]},
      usage:{prompt_tokens:80,completion_tokens:90}};
  };
  t.mock.method(globalThis,'fetch',async address=>{
    const {pathname,searchParams}=new URL(address);
    const marker='NEXUS-MISSION: '+markerId;
    if(pathname.endsWith('/access_tokens'))return Response.json({token:'mock-scope'});
    if(pathname.endsWith('/issues/2'))return Response.json({number:2,body:marker});
    if(pathname.endsWith('/pulls/8/files'))return Response.json([{filename:'src/cadastro.test.ts',status:'modified'},
      {filename:'src/cadastro.ts',status:'modified'},{filename:'.env',status:'modified'}]);
    if(pathname.includes('/contents/')){
      assert.equal(searchParams.get('ref'),commit);
      assert.doesNotMatch(pathname,/\.env/);
      return Response.json({type:'file',encoding:'base64',content:btoa(pathname.endsWith('.test.ts')?
        'test.skip("cadastro", () => {});':'export const cadastro = 1;')});
    }
    if(pathname.endsWith('/pulls/8'))return Response.json({number:8,body:marker,changed_files:3,base:{repo:{id:12},ref:'main'},
      head:{repo:{id:12},ref:branch,sha:commit}});
    if(pathname.includes('/check-runs'))return Response.json({check_runs:[{name:'validar',head_sha:commit,
      app:{slug:'github-actions'},status:'completed',conclusion:ci}]});
    throw Error('Rota inesperada');
  });
  const base='/nexus/missions';
  assert.equal((await call(base,undefined,'z'.repeat(43))).status,401);
  const spec={schema:1,id,repoId:12,issue:2,pr:8,baseRef:'main',branch,objective:'Melhorar cadastro',
    checks:['validar'],constraints:['Somente leitura'],nonGoals:[],criteria:[{id:'cadastro',description:'Completar cadastro',
      expectedEvidence:'Vídeo de execução'}]};
  const prepare={repoId:12,issue:2,pr:8,objective:spec.objective,checks:spec.checks,criteria:spec.criteria};
  assert.equal((await call('/nexus/prepare',prepare,'z'.repeat(43))).status,401);
  assert.equal((await call('/nexus/prepare',{...prepare,repoId:999})).status,403);
  assert.equal((await call('/nexus/prepare',{...prepare,checks:[]})).status,400);
  markerId=id.toUpperCase()+'\nNEXUS-MISSION: '+id;
  assert.equal((await call('/nexus/prepare',prepare)).status,409);
  markerId=id.toUpperCase();
  const preparedResponse=await call('/nexus/prepare',prepare);
  assert.equal(preparedResponse.status,200);
  const prepared=await preparedResponse.json();
  assert.equal(prepared.brief.id,id);
  assert.equal(prepared.brief.branch,branch);
  assert.equal(prepared.commit,commit);
  const changed='b'.repeat(40);commit=changed;
  assert.equal((await call(base,{...prepared.brief,expectedCommit:prepared.commit})).status,409);
  commit='a'.repeat(40);
  const created=await call(base,{...prepared.brief,expectedCommit:prepared.commit});
  assert.equal(created.status,201);
  assert.equal((await created.json()).mission.brief.executor,'web');
  db.prepare("UPDATE nexus_missions_v1 SET record=json_remove(record,'$.brief.executor') WHERE id=?").run(id);
  const legacy=(await (await call(base+'/'+id)).json()).execution;
  assert.deepEqual(legacy,{mode:'web',issueUrl:'https://github.com/owner/repo/issues/2',
    prUrl:'https://github.com/owner/repo/pull/8',result:null});
  let version=0;
  const path=base+'/'+id;
  async function send(type,payload,status=200,id=crypto.randomUUID()) {
    const r=await call(path+'/events',{id,type,payload,version});
    assert.equal(r.status,status);
    const data=await r.json();
    if(status===200)version=data.version;
    return data;
  }
  const eventId=crypto.randomUUID();
  await send('spec_ready',undefined,200,eventId);
  assert.equal((await send('spec_ready',undefined,200,eventId)).duplicate,true);
  assert.equal((await send('executor',{mode:'cli'})).mission.status,'SPEC_READY');
  assert.equal((await (await call(path)).json()).execution.mode,'cli');
  await send('executor',{mode:'web'});
  await send('executor',{mode:'automation'},409);
  await send('start');
  await send('executor',{mode:'cli'},409);
  branch='other';await send('sync',undefined,409);branch='nexus-test';
  await send('sync');
  const initial=await send('audit',{model:true});
  assert.equal(initial.mission.status,'EVIDENCE_MISSING');
  assert.equal(initial.mission.director.model.state,'completed');
  assert.equal(initial.mission.director.model.observations.length,1);
  assert.equal(modelCalls,1);
  assert.doesNotMatch(JSON.stringify(initial.mission.remote),/test\.skip|export const/);
  await send('audit',{model:true},429);

  assert.equal(initial.mission.director.verified.some(item=>item.text.includes('src/cadastro.ts')),true);
  assert.equal(initial.mission.director.hypotheses.some(item=>item.text.includes('ignorado')),true);
  assert.doesNotMatch(JSON.stringify(initial.mission.director),/test\.skip|export const/);
  const url='https://github.com/owner/repo';
  const record={commit,status:'passed',url,reason:'Observei e verifiquei as evidências no teste.'};
  await send('attest',{...record,axis:'experience'},409);
  await send('attest',{...record,commit:'c'.repeat(40),axis:'correctness'},409);
  await send('revision_request',{commit,priority:'P1',location:'Tela Cadastro',why:'Controle sem nome acessível',
    expected:'Leitor anuncia o campo',test:'Completar cadastro com leitor',url});
  await send('start');
  db.prepare("UPDATE nexus_missions_v1 SET record=json_set(record,'$.lastSyncAt',0) WHERE id=?").run(id);
  await send('sync',undefined,409);
  commit='b'.repeat(40);
  await send('sync');
  const dimensions=['navegação','clareza','design','responsividade','acessibilidade','tarefas principais'];
  await send('attest',{...record,commit,status:'failed',axis:'experience',functionalUrl:url,visualUrl:url,dimensions});
  ci='failure';
  const second=await send('audit',{model:true});
  assert.equal(second.mission.status,'CHANGES_REQUIRED');
  assert.equal(second.mission.director.model.state,'quota');
  assert.equal(modelCalls,1);
  const used=await (await call('/status')).json();
  assert.equal(used.dailyUsed,1);
  assert.equal((await send('approve',{commit},409)).error.length>0,true);
  const detail=await (await call(path)).json();
  assert.equal(detail.review.delivery,'manual');
  assert.deepEqual(detail.execution.result,{commit,ci:'failed'});
  assert.equal(detail.events.filter(event=>event.type==='executor').length,2);
  assert.equal(detail.review.correctionPackage.delivery,'manual');
  assert.equal(detail.review.correctionPackage.revision,commit);
  assert.equal(detail.review.correctionPackage.requests.some(item=>item.location==='validar'),true);
  assert.equal(detail.review.gate.approved,false);
  assert.equal(detail.events.some(e=>e.type==='revision_request'),true);
  assert.equal(count(),0);
  db.prepare("UPDATE github_repos_v15 SET state='paused' WHERE id=12").run();
  await send('start',undefined,409);
  db.prepare("UPDATE github_inventory_v15 SET availability='removed' WHERE repo=12").run();
  assert.equal((await call(path)).status,404);
});
