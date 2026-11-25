import { runNexusModel } from './nexus-model.mjs';
import { evaluateQualityGate, qualityAxes } from './excellence-engine.mjs';
import { nexusGitHubEvidence, nexusLinkedScope } from './github.mjs';
import { idPattern } from './recovery.mjs';

const uxDimensions=['navegação','clareza','design','responsividade','acessibilidade','tarefas principais'];
const publicText=(value,max=400)=>typeof value==='string' && value.trim().length>=1 &&
  value.length<=max && !/-----BEGIN |\b(?:gh[pousr]_|github_pat_|sk-proj-|AKIA)[a-z\d_]+/i.test(value);
const shortList=(items,max)=>Array.isArray(items)&&items.length<=max&&items.every(item=>publicText(item,240));
const ref=value=>publicText(value,140)&&/^[\w.-]+(?:\/[\w.-]+)*$/.test(value)&&value.split('/').every(x=>x!=='.'&&x!=='..');
const number=value=>Number.isSafeInteger(value)&&value>0;
const url=value=>{
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&value.length<=500;}
  catch{return false;}
};
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>reply({error:message},status);

const executionModes=['web','cli'];

export function validBrief(b) {
  return b?.schema===1&&idPattern.test(b.id??'')&&number(b.repoId)&&number(b.issue)&&(b.pr==null||number(b.pr))&&
    ref(b.baseRef)&&ref(b.branch)&&b.baseRef!==b.branch&&publicText(b.objective,1200)&&
    shortList(b.constraints,10)&&shortList(b.nonGoals,10)&&shortList(b.checks,8)&&b.checks.length>0&&new Set(b.checks).size===b.checks.length&&
    Array.isArray(b.criteria)&&b.criteria.length>0&&b.criteria.length<=15&&
    new Set(b.criteria.map(c=>c?.id)).size===b.criteria.length&&
    b.criteria.every(c=>c&&/^[a-z\d][a-z\d_-]{0,31}$/.test(c.id)&&!['constructor','prototype'].includes(c.id)&&publicText(c.description,300)&&publicText(c.expectedEvidence,300))&&
    (b.projectBrief===undefined||publicText(b.projectBrief,12000))&&
    (b.executor===undefined||executionModes.includes(b.executor))&&
    (b.maxIterations===undefined||(number(b.maxIterations)&&b.maxIterations<=5));
}

function assessment(m,ownerApproved=false) {
  const checks=Object.entries(m.evidence).flatMap(([axis,item])=>{
    if(axis==='experience'&&(!item.functionalUrl||!item.visualUrl))return [];
    return [{axis,status:item.status,revision:m.revision,trusted:true,source:'manual-review',
      evidence:item.reason,evidenceUrl:item.url}];
  });
  const gate=evaluateQualityGate({revision:m.revision,checks,authorized:ownerApproved,findings:m.findings});
  if(m.remote?.codex?.state==='completed'&&m.remote.codex.commit===m.revision&&m.remote.codex.unresolved===true)
    gate.blockers.push({axis:'codex',reason:'O Codex registrou apontamentos não resolvidos neste commit. Confira a revisão.'});
  const security=m.remote?.codexSecurity;
  if(security?.commit===m.revision&&(security.state==='running'||(security.state==='completed'&&security.unresolved===true)))
    gate.blockers.push({axis:'security-review',reason:security.state==='running'?'A revisão de segurança do Codex ainda está em andamento.':'A revisão de segurança registrou apontamentos não resolvidos neste commit.'});
  if(m.remote?.ci!=='passed')gate.blockers.push({axis:'ci',reason:'CI obrigatório sem confirmação de sucesso.'});
  if(m.brief.criteria.some(c=>!Object.hasOwn(m.criteria,c.id)||m.criteria[c.id].status!=='passed'))
    gate.blockers.push({axis:'criteria',reason:'Um ou mais critérios de aceite ainda aguardam evidências.'});
  return {...gate,approved:gate.blockers.length===0,state:gate.blockers.length?'blocked':'approved-for-review'};
}

export function directorReport(remote,now) {
  const files=remote.files??[];
  const checked=files.filter(file=>file.read);
  const verified=[
    {text:'Issue e PR correspondem à missão, ao repositório e ao commit indicado.',url:remote.prUrl},
    ...(remote.checks??[]).filter(check=>check.status!=='pending').map(check=>({
      text:check.name+': '+(check.status==='passed'?'sucesso registrado no GitHub Actions':'falha registrada no GitHub Actions'),
      url:remote.prUrl+'/checks',
    })),
    ...(remote.codex?.state==='completed'?[{text:'Codex: revisão registrada neste commit'+(remote.codex.unresolved?' · apontamentos em aberto':remote.codex.findings?' · apontamentos registrados, sem pendências informadas':' · sem apontamentos informados')+'.',url:remote.codex.url}]:[]),
    ...(remote.codexSecurity?.state==='completed'?[{text:'Codex: revisão de segurança registrada neste commit'+(remote.codexSecurity.unresolved?' · apontamentos em aberto':remote.codexSecurity.findings?' · apontamentos registrados, sem pendências informadas':' · sem apontamentos informados')+'.',url:remote.codexSecurity.url}]:[]),
    ...checked.map(file=>({text:file.path+' · '+file.lines+' linhas na amostra',
      url:'https://github.com/'+remote.repo+'/blob/'+remote.commit+'/'+file.path.split('/').map(encodeURIComponent).join('/')})),
  ];
  const hypotheses=checked.filter(file=>file.disabledTestHint).map(file=>({
    text:'Há uma construção compatível com teste ignorado ou executado de forma exclusiva em '+file.path+
      '. Confirme se pertence ao código executado e se cobre o comportamento alterado.',
  }));
  if(remote.codex?.state==='completed'&&remote.codex.unresolved)
    hypotheses.push({text:'O Codex informou apontamentos não resolvidos neste commit. Consulte o relatório antes de decidir.'});
  if(files.some(file=>file.role!=='Testes')&&!files.some(file=>file.role==='Testes')&&remote.filesAvailable)
    hypotheses.push({text:'A lista consultada inclui alterações sem arquivo de teste correspondente. Confirme onde esses comportamentos são verificados.'});
  if(files.some(file=>file.path.startsWith('.github/workflows/')))
    hypotheses.push({text:'O PR altera a definição dos workflows. Revise quais etapas foram preservadas antes de confiar no resultado verde.'});
  if(checked.some(file=>['Autenticação e acesso','Persistência'].includes(file.role)))
    hypotheses.push({text:'Há alterações em um caminho de acesso ou persistência. Confira o efeito sobre autorização, dados anteriores e recuperação.'});
  const requests=(remote.checks??[]).filter(check=>check.status==='failed').map(check=>({
    priority:'P1',location:check.name,why:'O GitHub Actions registrou falha neste commit.',
    expected:'Corrigir a causa e obter sucesso no check obrigatório para o novo SHA.',
    test:'Reexecutar '+check.name+' e vincular o resultado ao novo commit.',url:remote.prUrl+'/checks',
  }));
  return {commit:remote.commit,createdAt:now,verified,hypotheses,requests,ci:remote.ci,
    model:remote.modelReview??{state:'not_requested'},
    limits:[...(!remote.filesAvailable?['A lista de arquivos não estava disponível.']:
      !remote.filesComplete?['A lista de arquivos é parcial.']:[]),
      ...(remote.codexSecurity?.state!=='completed'?['Revisão independente de segurança neste SHA ainda não confirmada.']:[]),
      'A inspeção é amostral e não executa código. A experiência real ainda exige prova funcional e visual.']};
}

export function transition(m,event,remote,now) {
  const {type,payload={}}=event;
  const next=structuredClone(m);
  const from=(...states)=>states.includes(m.status);
  if(type==='spec_ready' && from('IDEA'))next.status='SPEC_READY';
  else if(type==='start' && from('SPEC_READY','CHANGES_REQUIRED')){
    if(m.iteration>=m.brief.maxIterations){next.status='PAUSED';next.reason='Limite de iterações atingido.';}
    else {next.status='IMPLEMENTING';next.iteration++;next.ownerApproval=null;next.reason=null;}
  }else if(type==='executor' && from('IDEA','SPEC_READY','CHANGES_REQUIRED') && executionModes.includes(payload.mode)){
    next.brief.executor=payload.mode;
  }else if(type==='link_pr' && from('IMPLEMENTING') && !m.brief.pr && number(payload.pr))next.brief.pr=payload.pr;
  else if(type==='decision' && !from('RELEASED','CANCELLED','FAILED') && publicText(payload.reason,600))next.lastDecisionAt=now;
  else if(type==='sync' && from('IMPLEMENTING','CI_PENDING','AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER') && remote){
    if(m.status==='IMPLEMENTING' && m.iteration>1 && remote.commit===m.revision)
      throw Error('A revisão solicitada exige um novo commit.');
    if(remote.commit!==m.revision){next.evidence={};next.criteria={};next.findings=[];next.ownerApproval=null;next.director=null;}
    next.revision=remote.commit;next.remote=remote;
    const reviewState=record=>JSON.stringify([record?.codex,record?.codexSecurity].map(r=>[r?.state,r?.commit,r?.unresolved,r?.findings]));
    const changed=remote.commit!==m.revision||remote.ci!==m.remote?.ci||reviewState(remote)!==reviewState(m.remote);
    if(changed){next.director=null;next.ownerApproval=null;}
    if(changed||from('IMPLEMENTING'))next.status=remote.ci==='pending'?'CI_PENDING':'AI_AUDIT';
  }else if(type==='attest' && from('AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER') && m.revision &&
    payload.commit===m.revision && ['passed','failed'].includes(payload.status) && url(payload.url)&&
    publicText(payload.reason,1000)&&payload.reason.trim().length>=12){
    const entry={status:payload.status,url:payload.url,reason:payload.reason,actor:'owner',recordedAt:now};
    if(payload.axis==='experience'){
      if(!url(payload.functionalUrl)||!url(payload.visualUrl)||!Array.isArray(payload.dimensions)||
        payload.dimensions.length!==uxDimensions.length||uxDimensions.some(d=>!payload.dimensions.includes(d)))
        throw Error('O Teste de Realidade exige prova funcional, visual e as seis dimensões de UX.');
      next.evidence.experience={...entry,functionalUrl:payload.functionalUrl,visualUrl:payload.visualUrl,dimensions:uxDimensions};
    }else if(qualityAxes.some(axis=>axis.id===payload.axis))next.evidence[payload.axis]=entry;
    else if(m.brief.criteria.some(c=>c.id===payload.criterion))next.criteria[payload.criterion]=entry;
    else throw Error('Critério inválido.');
    next.status='AI_AUDIT';next.ownerApproval=null;
  }else if(type==='audit' && from('AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER')){
    if(remote){
      if(remote.commit!==m.revision)throw Error('O PR mudou. Confira o novo commit antes de auditar.');
      next.remote=remote;
      next.director=directorReport(remote,now);
    }
    const gate=assessment(next,true);
    next.status=gate.approved?'READY_FOR_OWNER':next.remote?.ci==='failed'||
      Object.values({...m.evidence,...m.criteria}).some(item=>item.status==='failed')?'CHANGES_REQUIRED':'EVIDENCE_MISSING';
  }else if(type==='revision_request' && from('AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER','CHANGES_REQUIRED') &&
    payload.commit===m.revision && m.revision && ['P0','P1','P2'].includes(payload.priority) &&
    [payload.location,payload.expected,payload.test,payload.why].every(v=>publicText(v,400))&&url(payload.url)){
    next.findings=[...m.findings.slice(-19),{severity:payload.priority==='P2'?'medium':'high',status:'open',
      priority:payload.priority,location:payload.location,why:payload.why,expected:payload.expected,test:payload.test,url:payload.url}];
    next.status=m.iteration>=m.brief.maxIterations?'PAUSED':'CHANGES_REQUIRED';
    next.reason=next.status==='PAUSED'?'Limite de iterações atingido.':null;
  }else if(type==='approve' && from('READY_FOR_OWNER') && payload.commit===m.revision &&
    remote?.commit===m.revision && remote.ci==='passed' && assessment({...m,remote},true).approved){
    next.status='OWNER_APPROVED';next.ownerApproval={commit:m.revision,at:now,actor:'owner'};
  }else if(['pause','fail','cancel'].includes(type) && !from('RELEASED','CANCELLED','OWNER_APPROVED')&&publicText(payload.reason,400)){
    next.status={pause:'PAUSED',fail:'FAILED',cancel:'CANCELLED'}[type];next.reason=payload.reason;
  }else throw Error('Transição inválida ou evidência insuficiente para este commit.');
  next.updatedAt=now;
  return next;
}

async function visibleRepo(env,id,installation) {
  if(!installation||!number(id))return null;
  return env.DB.prepare(`SELECT p.id,p.name,p.state FROM github_repos_v15 p
    JOIN github_inventory_v15 i ON i.repo=p.id JOIN github_account_v15 a ON a.installation=i.installation
    WHERE p.id=? AND a.installation=? AND a.state!='disconnected' AND i.availability='available' AND p.state!='disconnected'`)
    .bind(id,installation).first();
}

export async function nexusRoute({env,path,method,read,now,quota}) {
  const installation=env.GITHUB_INSTALLATION_ID;
  if(!installation)return fail('NEXUS requer um repositório da instalação GitHub autorizada.',503);
  if(path==='/nexus/prepare'&&method==='POST'){
    const draft=await read(32_000);
    if(!draft||!number(draft.repoId)||!number(draft.issue)||!number(draft.pr))return fail('Selecione repositório, Issue e PR válidos.');
    const repo=await visibleRepo(env,draft.repoId,installation);
    if(!repo||repo.state!=='active')return fail('Repositório indisponível.',403);
    // Validate user-supplied brief fields before doing any remote work.
    const provisional={schema:1,id:'00000000-0000-4000-8000-000000000001',repoId:repo.id,issue:draft.issue,pr:draft.pr,
      baseRef:'base-preview',branch:'work-preview',objective:draft.objective,constraints:draft.constraints??[],
      nonGoals:draft.nonGoals??[],checks:draft.checks,criteria:draft.criteria,maxIterations:3,executor:'web',
      ...(draft.projectBrief===undefined?{}:{projectBrief:draft.projectBrief})};
    if(!validBrief(provisional))return fail('Informe objetivo, checks obrigatórios e critérios de aceite.');
    try{
      const {commit,...scope}=await nexusLinkedScope(env,repo,draft.issue,draft.pr);
      const brief={...provisional,...scope};
      if(!validBrief(brief))return fail('Escopo de branches inválido.');
      return reply({brief,commit,repository:repo.name});
    }catch{return fail('Não foi possível confirmar o vínculo entre Issue e PR. Confira os marcadores e o acesso.',409);}
  }
  const match=/^\/nexus\/(missions)(?:\/([a-f\d-]+)(\/events)?)?$/i.exec(path);
  if(!match)return fail('Rota inexistente.',404);
  const id=match[2];
  if(!id && method==='GET'){
    const rows=(await env.DB.prepare(`SELECT m.record FROM nexus_missions_v1 m
      JOIN github_inventory_v15 i ON i.repo=m.repo AND i.installation=m.installation
      JOIN github_account_v15 a ON a.installation=i.installation JOIN github_repos_v15 p ON p.id=i.repo
      WHERE m.installation=? AND i.availability='available' AND a.state!='disconnected' AND p.state!='disconnected'
      ORDER BY m.rowid DESC LIMIT 30`).bind(installation).all()).results;
    return reply({missions:rows.map(row=>JSON.parse(row.record))});
  }
  if(!id && method==='POST'){
    const draft=await read(32_000);
    if(!validBrief(draft))return fail('Brief inválido.');
    if(draft.adoptExisting!==undefined&&typeof draft.adoptExisting!=='boolean')return fail('Modo de criação inválido.');
    if(draft.adoptExisting===true&&(!draft.pr||typeof draft.expectedCommit!=='string'||! /^[a-f0-9]{40}$/.test(draft.expectedCommit)))
      return fail('Para conferir uma entrega existente, confirme o SHA e o PR.');
    const repo=await visibleRepo(env,draft.repoId,installation);
    if(!repo||repo.state!=='active')return fail('Repositório indisponível.',403);
    if(draft.pr!=null&&draft.expectedCommit!==undefined){
      if(typeof draft.expectedCommit!=='string'||! /^[a-f0-9]{40}$/.test(draft.expectedCommit))return fail('SHA de confirmação inválido.');
      try{
        const scope=await nexusLinkedScope(env,repo,draft.issue,draft.pr);
        if(scope.id!==draft.id||scope.baseRef!==draft.baseRef||scope.branch!==draft.branch||scope.commit!==draft.expectedCommit)
          return fail('O escopo ou o commit mudou. Prepare a missão novamente.',409);
      }catch{return fail('Não foi possível reconfirmar a entrega no GitHub.',409);}
    }
    const claimed=await env.DB.prepare(`SELECT 1 AS found FROM nexus_missions_v1 WHERE installation=? AND repo=?
      AND json_extract(record,'$.brief.branch')=? AND json_extract(record,'$.status') NOT IN ('CANCELLED','FAILED','RELEASED')`)
      .bind(installation,repo.id,draft.branch).first();
    if(claimed)return fail('Esta branch já possui uma missão.',409);
    const brief={schema:1,id:draft.id,repoId:draft.repoId,issue:draft.issue,pr:draft.pr??null,baseRef:draft.baseRef,branch:draft.branch,
      objective:draft.objective,nonGoals:draft.nonGoals,constraints:draft.constraints,checks:draft.checks,
      criteria:draft.criteria.map(({id,description,expectedEvidence})=>({id,description,expectedEvidence})),maxIterations:draft.maxIterations??3,executor:draft.executor??'web',
      ...(draft.projectBrief===undefined?{}:{projectBrief:draft.projectBrief})};
    let mission={id:brief.id,brief,repository:repo.name,status:'IDEA',createdAt:now,updatedAt:now,revision:null,iteration:0,
      budget:{aiCalls:0,paid:false},reviewer:'IA Pessoal',evidence:{},criteria:{},findings:[],ownerApproval:null};
    if(draft.adoptExisting===true){
      // Observation of an existing PR is not evidence that an agent implemented it.
      let remote;
      try {remote=await nexusGitHubEvidence(env,repo,brief,true,false);}
      catch{return fail('Não foi possível conferir a entrega. Nenhuma missão foi criada.',409);}
      if(remote.commit!==draft.expectedCommit)return fail('O commit mudou. Prepare a missão novamente.',409);
      delete remote.samples;
      mission={...mission,revision:remote.commit,remote,iteration:1,lastSyncAt:now,
        status:remote.ci==='pending'?'CI_PENDING':'AI_AUDIT',
        intake:{kind:'existing_delivery',commit:remote.commit,at:now,actor:'owner'}};
      if(mission.status==='AI_AUDIT')mission=transition(mission,{type:'audit'},remote,now);
    }
    // Recheck access and uniqueness at the write, after the remote reads.
    const added=await env.DB.prepare(`INSERT OR IGNORE INTO nexus_missions_v1
      SELECT ?,?,?,0,? WHERE EXISTS(SELECT 1 FROM github_repos_v15 p JOIN github_inventory_v15 i ON p.id=i.repo
        JOIN github_account_v15 a ON a.installation=i.installation WHERE p.id=? AND i.installation=?
        AND p.state='active' AND i.availability='available' AND a.state!='disconnected')
      AND NOT EXISTS(SELECT 1 FROM nexus_missions_v1 WHERE installation=? AND repo=?
        AND json_extract(record,'$.brief.branch')=? AND json_extract(record,'$.status') NOT IN ('CANCELLED','FAILED','RELEASED'))
      RETURNING id`)
      .bind(mission.id,repo.id,installation,JSON.stringify(mission),repo.id,installation,installation,repo.id,draft.branch).first();
    return added?reply({mission,version:0},201):fail('Missão já existe ou repositório indisponível.',409);
  }
  if(!idPattern.test(id??''))return fail('Identificador inválido.');
  const row=await env.DB.prepare('SELECT * FROM nexus_missions_v1 WHERE id=? AND installation=?').bind(id,installation).first();
  const repo=row&&await visibleRepo(env,row.repo,installation);
  if(!row||!repo)return fail('Missão não encontrada.',404);
  const m=JSON.parse(row.record);
  if(method==='GET'&&!match[3]){
    const events=(await env.DB.prepare('SELECT record FROM nexus_events_v1 WHERE mission=? ORDER BY version DESC LIMIT 100')
      .bind(id).all()).results.map(item=>JSON.parse(item.record));
    const executor=m.brief.executor??'web';
    const github='https://github.com/'+repo.name;
    return reply({mission:m,version:row.version,events,execution:{mode:executor,
      issueUrl:github+'/issues/'+m.brief.issue,prUrl:m.brief.pr?github+'/pull/'+m.brief.pr:null,
      result:m.remote?.commit?{commit:m.remote.commit,ci:m.remote.ci}:null,
      ...(m.remote?.codex?{codex:m.remote.codex}:{}),...(m.remote?.codexSecurity?{codexSecurity:m.remote.codexSecurity}:{})},
      review:{schema:1,missionId:id,commit:m.revision,
      repository:m.repository,status:m.status,gate:assessment(m,m.status==='OWNER_APPROVED'),requests:m.findings,criteria:m.criteria,evidence:m.evidence,
      issue:m.remote?.issueUrl,pr:m.remote?.prUrl,delivery:'manual',director:m.director??null,
      correctionPackage:{schema:1,kind:'nexus.revision_request',delivery:'manual',missionId:id,revision:m.revision,
        repository:m.repository,branch:m.brief.branch,requests:[...m.findings,...(m.director?.requests??[])]}}});
  }
  if(method!=='POST'||!match[3])return fail('Rota inexistente.',404);
  if(repo.state!=='active')return fail('Repositório pausado.',409);
  const event=await read(7000);
  const eventTypes=['spec_ready','start','executor','link_pr','decision','sync','attest','audit','revision_request','approve','pause','fail','cancel'];
  if(!idPattern.test(event?.id??'')||!eventTypes.includes(event?.type)||!Number.isSafeInteger(event.version)||
    (event.payload!=null&&(typeof event.payload!=='object'||Array.isArray(event.payload))))return fail('Evento inválido.');
  const duplicate=await env.DB.prepare('SELECT mission FROM nexus_events_v1 WHERE id=?').bind(event.id).first();
  if(duplicate && duplicate.mission!==id)return fail('Evento já vinculado a outra missão.',409);
  if(duplicate)return reply({duplicate:true,mission:m,version:row.version});
  if(event.version!==row.version)return fail('Versão desatualizada. Reabra a missão.',409);
  if(((event.type==='sync'&&m.lastSyncAt&&now-m.lastSyncAt<30_000)||
      (event.type==='audit'&&m.director&&now-m.director.createdAt<30_000)))return fail('Aguarde 30 segundos para sincronizar.',429);
  let next,remote;
  if(!['OWNER_APPROVED','CANCELLED','FAILED','PAUSED'].includes(m.status) && ['sync','approve','audit'].includes(event.type)){
    if(!m.brief.pr)return fail('Vincule o número do PR antes de sincronizar.',409);
    const useModel=event.type==='audit'&&event.payload?.model===true&&
      ['AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER'].includes(m.status);
    try {remote=await nexusGitHubEvidence(env,repo,m.brief,event.type==='audit',useModel);}
    catch{return fail('Não foi possível verificar o Issue e o PR no GitHub. Confira o marcador, a branch e as permissões.',409);}
    if(useModel&&remote.commit===m.revision)remote.modelReview=await runNexusModel(env,{remote,mission:m,version:row.version,eventId:event.id,now,quota});
    // Source samples are transient and never enter the mission or audit journal.
    delete remote.samples;
    if((!remote.modelReview||remote.modelReview.state==='already_run')&&m.director?.commit===m.revision&&m.director.model?.state==='completed')
      remote.modelReview=m.director.model;
  }
  try {next=transition(m,event,remote,now);}
  catch(error){return fail(error.message,409);}
  if(event.type==='sync')next.lastSyncAt=now;
  const entry={id:event.id,type:event.type,actor:'owner',at:now,commit:next.revision,
    status:next.status,reason:event.type==='decision'?event.payload.reason:event.type==='executor'?
      'Executor selecionado: '+event.payload.mode:next.reason??null,
    evidenceRefs:event.type==='attest'?[event.payload.url,...(event.payload.axis==='experience'?[event.payload.functionalUrl,event.payload.visualUrl]:[])]:[],
    details:event.type==='attest'?{axis:event.payload.axis,criterion:event.payload.criterion,
      status:event.payload.status,reason:event.payload.reason}:event.type==='revision_request'?next.findings.at(-1):event.type==='audit'?next.director:null};
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO nexus_events_v1 SELECT ?,?,?,? WHERE EXISTS(
      SELECT 1 FROM nexus_missions_v1 m JOIN github_repos_v15 p ON p.id=m.repo
      JOIN github_inventory_v15 i ON i.repo=p.id AND i.installation=m.installation
      JOIN github_account_v15 a ON a.installation=m.installation
      WHERE m.id=? AND m.version=? AND p.state='active' AND i.availability='available' AND a.state!='disconnected')`)
      .bind(event.id,id,row.version+1,JSON.stringify(entry),id,row.version),
    env.DB.prepare('UPDATE nexus_missions_v1 SET version=version+1,record=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM nexus_events_v1 WHERE id=? AND mission=? AND version=?)')
      .bind(JSON.stringify(next),id,row.version,event.id,id,row.version+1),
  ]);
  const saved=await env.DB.prepare(`SELECT m.record,m.version FROM nexus_missions_v1 m
    JOIN nexus_events_v1 e ON e.mission=m.id WHERE m.id=? AND e.id=?`).bind(id,event.id).first();
  return saved?reply({mission:JSON.parse(saved.record),version:saved.version}):fail('Conflito de versão.',409);
}
