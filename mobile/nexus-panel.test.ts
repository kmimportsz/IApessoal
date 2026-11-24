import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';

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
};
const component={exports:{}};
new Function('module','exports','require',outputText)(component,component.exports,name=>stubs[name]??require(name));
const {NexusPanel}=component.exports;

test('Transição atualiza o status na lista sem consultar todas as missões novamente',async t=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;

  const mission={id:'example',repository:'owner/repo',status:'IDEA',revision:null,iteration:0,
    brief:{objective:'Atualizar lista',maxIterations:3,criteria:[]}};
  let current=mission;
  let version=0;
  const requests=[];
  async function request(path,data){
    requests.push(path);
    if(path==='/nexus/missions')return Response.json({missions:[current,{...mission,id:'other',repository:'owner/other'}]});
    if(path.endsWith('/events')){
      assert.equal(data.type,'spec_ready');
      assert.equal(data.version,0);
      current={...mission,status:'SPEC_READY'};
      version++;
      return Response.json({mission:current,version});
    }
    assert.equal(path,'/nexus/missions/example');
    return Response.json({mission:current,version,events:[],review:{gate:{blockers:[]}}});
  }
  let root;
  await act(async()=>{root=create(createElement(NexusPanel,{request}));});
  t.after(async()=>{
    await act(async()=>root.unmount());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const buttons=()=>root.root.findAllByType('Pressable');
  const label=button=>button.findByType('Text').props.children;
  const press=async text=>act(async()=>buttons().find(button=>label(button)===text).props.onPress());
  await press('Consultar missões');
  await press('owner/repo · IDEA');
  await press('Confirmar especificação');
  assert.ok(buttons().some(button=>label(button)==='Registrar início da implementação'),'detalhes já refletem a transição');
  assert.ok(buttons().some(button=>label(button)==='owner/repo · SPEC_READY'),'a lista também deve refletir a transição');
  assert.ok(buttons().some(button=>label(button)==='owner/other · IDEA'),'outras missões preservam o status');
  assert.equal(requests.filter(path=>path==='/nexus/missions').length,1);
});
