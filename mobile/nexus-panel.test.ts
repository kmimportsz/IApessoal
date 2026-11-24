import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';
import * as operations from './nexus-operations.ts';

const require=createRequire(import.meta.url);
const {createElement}=require('react');
const {create,act}=require('react-test-renderer');
const source=readFileSync(new URL('./NexusPanel.tsx',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,
}});
const stubs={
  'react-native':{Pressable:'Pressable',Text:'Text',TextInput:'TextInput',View:'View',StyleSheet:{create:styles=>styles}},
  'expo-crypto':{randomUUID:()=> 'event-id'},
  './visual':{palette:{}},
  './nexus-operations':operations,
};
const component={exports:{}};
new Function('module','exports','require',outputText)(component,component.exports,name=>stubs[name]??require(name));
const {NexusPanel}=component.exports;

const mission={id:'example',repository:'owner/repo',status:'IDEA',revision:null,iteration:0,
  brief:{objective:'Atualizar lista',maxIterations:3,criteria:[]}};
const other={...mission,id:'other',repository:'owner/other'};
const details=(current,version)=>({mission:current,version,events:[],review:{gate:{blockers:[]}}});

async function mount(t,request,onNavigate,repos,handoff,onHandoffConsumed){
  const prior=globalThis.IS_REACT_ACT_ENVIRONMENT;
  let root;
  // Register cleanup before the first render, including exceptional paths.
  t.after(async()=>{try{if(root)await act(async()=>root.unmount());}finally{
    if(prior===undefined)delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT=prior;
  }});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  await act(async()=>{root=create(createElement(NexusPanel,{request,onNavigate,repos,handoff,onHandoffConsumed}));});
  const buttons=()=>root.root.findAllByType('Pressable');
  const label=b=>b.props.accessibilityLabel??b.findAllByType('Text')[0]?.props.children;
  const has=text=>buttons().some(b=>label(b)===text);
  const press=async text=>{const b=buttons().find(b=>label(b)===text);assert.ok(b,'Ação ausente: '+text);assert.equal(b.props.disabled,false);await act(async()=>b.props.onPress());};
  const rendered=()=>JSON.stringify(root.toJSON());
  const change=async(label,value)=>{const field=root.root.findAllByType('TextInput').find(x=>x.props.accessibilityLabel===label);assert.ok(field,'Campo ausente: '+label);await act(async()=>field.props.onChangeText(value));};
  return {has,press,rendered,change};
}

test('Missão abre em vista exclusiva, esconde JSON e preserva transição ao voltar',async t=>{
  let current=mission,version=0;
  const requests=[];
  const ui=await mount(t,async(path,data)=>{
    requests.push(path);
    if(path==='/nexus/missions')return Response.json({missions:[current,other]});
    if(path.endsWith('/events')){
      assert.equal(data.type,'spec_ready');assert.equal(data.version,0);
      current={...mission,status:'SPEC_READY'};version++;
      return Response.json({mission:current,version});
    }
    assert.equal(path,'/nexus/missions/example');
    return Response.json(details(current,version));
  });
  assert.equal(ui.has('owner/repo · Ideia recebida'),true);
  assert.equal(ui.rendered().includes('Brief JSON da missão'),false);
  await ui.press('Importar missão (avançado)');
  assert.equal(ui.rendered().includes('Brief JSON da missão'),true);
  await ui.press('owner/repo · Ideia recebida');
  assert.equal(ui.has('Voltar às missões'),true);
  assert.equal(ui.has('owner/other · Ideia recebida'),false);
  assert.equal(ui.rendered().includes('Brief JSON da missão'),false);
  assert.ok(ui.rendered().includes('Etapas da entrega'));
  await ui.press('Confirmar especificação');
  assert.equal(ui.has('Registrar início da implementação'),true);
  await ui.press('Voltar às missões');
  assert.equal(ui.has('owner/repo · Planejamento pronto'),true);
  assert.equal(ui.has('owner/other · Ideia recebida'),true);
  assert.equal(requests.filter(path=>path==='/nexus/missions').length,1);
});

test('GET de detalhe com falha oferece erro, nova tentativa e retorno',async t=>{
  let fail=true;
  const ui=await mount(t,async path=>{
    if(path==='/nexus/missions')return Response.json({missions:[mission]});
    return fail?Response.json({error:'Falha de teste ao abrir'},{status:500}):Response.json(details(mission,0));
  });
  await ui.press('owner/repo · Ideia recebida');
  assert.ok(ui.rendered().includes('Falha de teste ao abrir'));
  assert.equal(ui.has('Tentar novamente'),true);
  assert.equal(ui.has('Voltar às missões'),true);
  assert.equal(ui.has('Confirmar especificação'),false);
  fail=false;
  await ui.press('Tentar novamente');
  assert.equal(ui.has('Confirmar especificação'),true);
  await ui.press('Voltar às missões');
  assert.equal(ui.has('owner/repo · Ideia recebida'),true);
});

test('POST confirmado com GET 500 não usa versão antiga nem libera ações obsoletas',async t=>{
  let current=mission,version=0,fail=false;
  const sent=[];
  const ui=await mount(t,async(path,data)=>{
    if(path==='/nexus/missions')return Response.json({missions:[current]});
    if(path.endsWith('/events')){
      sent.push(data.version);
      assert.equal(data.version,version);
      version++;
      current={...current,status:version===1?'SPEC_READY':'IMPLEMENTING'};
      fail=version===1;
      return Response.json({mission:current,version});
    }
    return fail?Response.json({error:'Relatório indisponível'},{status:500}):Response.json(details(current,version));
  });
  await ui.press('owner/repo · Ideia recebida');
  await ui.press('Confirmar especificação');
  assert.ok(ui.rendered().includes('A alteração foi registrada'));
  assert.equal(ui.has('Confirmar especificação'),false);
  assert.equal(ui.has('Registrar início da implementação'),false);
  assert.equal(ui.has('Tentar novamente'),true);
  fail=false;
  await ui.press('Tentar novamente');
  await ui.press('Registrar início da implementação');
  assert.deepEqual(sent,[0,1]);
  await ui.press('Voltar às missões');
  assert.equal(ui.has('owner/repo · Em implementação'),true);
});

test('Navegação notifica o contêiner ao abrir missão do fim de uma lista e ao retornar',async t=>{
  const entries=Array.from({length:30},(_,i)=>({...mission,id:'m'+i,repository:'owner/repo-'+i}));
  let navigations=0;
  const ui=await mount(t,async path=>path==='/nexus/missions'?Response.json({missions:entries}):
    Response.json(details(entries[29],0)),()=>{navigations++;});
  await ui.press('owner/repo-29 · Ideia recebida');
  assert.equal(navigations,1);
  assert.equal(ui.has('Voltar às missões'),true);
  await ui.press('Voltar às missões');
  assert.equal(navigations,2);
  assert.equal(ui.has('owner/repo-29 · Ideia recebida'),true);
});

test('AutoPilot usa versões confirmadas e para sem aprovar',async t=>{
  let current={...mission,status:'IMPLEMENTING'},version=5;
  const sent=[];
  const ui=await mount(t,async(path,data)=>{
    if(path==='/nexus/missions')return Response.json({missions:[current]});
    if(path.endsWith('/events')){
      sent.push(data.type+':'+data.version);assert.equal(data.version,version);
      version++;current={...current,status:data.type==='sync'?'AI_AUDIT':'EVIDENCE_MISSING'};
      return Response.json({mission:current,version});
    }
    return Response.json({...details(current,version),execution:{mode:'web',prUrl:'https://github.com/owner/repo/pull/1'}});
  });
  await ui.press('owner/repo · Em implementação');
  await ui.press('AutoPilot · conferir e auditar');
  assert.deepEqual(sent,['sync:5','audit:6']);
  assert.ok(ui.rendered().includes('Aguardando evidências'));
  assert.equal(ui.has('Registrar minha aprovação'),false);
});

test('Entrada conectada verifica vínculo, invalida edição e reconfirma SHA antes de criar',async t=>{
  const commit='a'.repeat(40);
  const payload={schema:1,id:'example',repoId:12,issue:2,pr:8,baseRef:'main',branch:'work',objective:'Cadastro',checks:['validar'],constraints:[],nonGoals:[],criteria:[{id:'delivery',description:'Salvar',expectedEvidence:'Teste funcional'}],maxIterations:3};
  const registered={...mission,brief:payload};
  let prepared=0,created=0,fail=true;
  const ui=await mount(t,async(path,data)=>{
    if(path==='/nexus/prepare'){
      prepared++;assert.equal(data.repoId,12);assert.equal(data.issue,2);assert.equal(data.pr,8);assert.deepEqual(data.checks,['validar']);
      if(fail)return Response.json({error:'Vínculo divergente'},{status:409});
      return Response.json({brief:{...payload,objective:data.objective},commit,repository:'owner/repo'});
    }
    if(path==='/nexus/missions'&&data){created++;assert.equal(data.expectedCommit,commit);assert.equal(data.objective,'Cadastro atualizado');return Response.json({mission:registered,version:0},{status:201});}
    if(path==='/nexus/missions')return Response.json({missions:[]});
    return Response.json(details(registered,0));
  },undefined,[{id:12,name:'owner/repo'}]);
  await ui.press('Vincular entrega do GitHub');await ui.press('owner/repo');
  await ui.change('Número do Issue','2');await ui.change('Número do PR','8');
  await ui.change('Objetivo da entrega','Cadastro');await ui.change('Checks obrigatórios (um por linha)','validar');
  await ui.change('Critério de aceite','Salvar');await ui.change('Evidência esperada','Teste funcional');
  await ui.press('Conferir vínculo');assert.match(ui.rendered(),/Vínculo divergente/);
  assert.equal(ui.has('Confirmar e criar missão'),false);
  fail=false;await ui.press('Conferir vínculo');assert.equal(ui.has('Confirmar e criar missão'),true);
  assert.equal(created,0);
  await ui.change('Objetivo da entrega','Cadastro atualizado');assert.equal(ui.has('Confirmar e criar missão'),false);
  await ui.press('Conferir vínculo');await ui.press('Confirmar e criar missão');
  assert.equal(prepared,3);assert.equal(created,1);assert.equal(ui.has('Voltar às missões'),true);
  await ui.press('Voltar às missões');assert.equal(ui.has('owner/repo · Ideia recebida'),true);
});

test('Briefing da Factory segue para entrega confirmada sem simular início do Codex',async t=>{
  const commit='a'.repeat(40);
  const handoff={objective:'Melhorar cadastro',projectBrief:'Identidade azul e dados preservados.'};
  const payload={schema:1,id:'example',repoId:12,issue:2,pr:8,baseRef:'main',branch:'work',objective:handoff.objective,projectBrief:handoff.projectBrief,
    checks:['validar'],constraints:[],nonGoals:[],criteria:[{id:'delivery',description:'Salvar',expectedEvidence:'Teste funcional'}],maxIterations:3};
  const registered={...mission,brief:payload,status:'EVIDENCE_MISSING',revision:commit,intake:{kind:'existing_delivery',commit,at:1}};
  let prepared=0,created=0,consumed=0;
  const ui=await mount(t,async(path,data)=>{
    if(path==='/nexus/prepare'){prepared++;assert.equal(data.projectBrief,handoff.projectBrief);assert.equal(data.objective,handoff.objective);return Response.json({brief:payload,commit,repository:'owner/repo'});}
    if(path==='/nexus/missions'&&data){created++;assert.equal(data.adoptExisting,true);assert.equal(data.expectedCommit,commit);assert.equal(data.projectBrief,handoff.projectBrief);return Response.json({mission:registered,version:0},{status:201});}
    if(path==='/nexus/missions')return Response.json({missions:[]});
    return Response.json(details(registered,0));
  },undefined,[{id:12,name:'owner/repo'}],handoff,()=>{consumed++;});
  assert.equal(prepared,0);assert.equal(created,0);assert.ok(consumed>=1);
  await ui.press('owner/repo');
  await ui.change('Número do Issue','2');await ui.change('Número do PR','8');
  await ui.change('Checks obrigatórios (um por linha)','validar');
  await ui.change('Critério de aceite','Salvar');await ui.change('Evidência esperada','Teste funcional');
  await ui.press('Conferir vínculo');assert.equal(created,0);
  await ui.press('Criar missão e conferir entrega');
  assert.equal(created,1);assert.match(ui.rendered(),/autoria da implementação não foi comprovada/);
  assert.equal(ui.has('Registrar minha aprovação'),false);
});
