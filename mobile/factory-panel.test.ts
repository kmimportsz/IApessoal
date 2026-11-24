import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';
import * as factory from './factory.ts';

const require=createRequire(import.meta.url);
const {createElement}=require('react');
const {create,act}=require('react-test-renderer');
const {outputText}=ts.transpileModule(readFileSync(new URL('./FactoryPanel.tsx',import.meta.url),'utf8'),{compilerOptions:{
  module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,
}});
let generated=0;
const stubs={
  'react-native':{Pressable:'Pressable',Text:'Text',TextInput:'TextInput',View:'View',StyleSheet:{create:styles=>styles}},
  'expo-crypto':{randomUUID:()=> 'generated-'+ ++generated},
  'expo-clipboard':{},
  './visual':{palette:{}},
  './factory':factory,
};
const component={exports:{}};
new Function('module','exports','require',outputText)(component,component.exports,name=>stubs[name]??require(name));
const {FactoryPanel}=component.exports;

test('Limite de 30 perfis bloqueia pedido implícito e permite usar perfil existente',async t=>{
  const previous=globalThis.IS_REACT_ACT_ENVIRONMENT;
  let root;
  t.after(async()=>{try{if(root)await act(async()=>root.unmount());}finally{
    if(previous===undefined)delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT=previous;
  }});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const profiles=Array.from({length:30},(_,i)=>({...factory.emptyProfile('p-'+i),name:'Projeto '+i,purpose:'Objetivo '+i}));
  const session={drafts:{}};
  const db={execAsync:async()=>{},getFirstAsync:async()=>({record:JSON.stringify(profiles)}),runAsync:async()=>{throw Error('Não deve gravar neste teste');}};
  await act(async()=>{root=create(createElement(FactoryPanel,{db,session}));});
  const field=()=>root.root.findAllByType('TextInput').find(n=>n.props.accessibilityLabel==='Pedido atual');
  const button=label=>root.root.findAllByType('Pressable').find(n=>n.findAllByType('Text')[0]?.props.children===label);
  const press=async label=>{const b=button(label);assert.ok(b);assert.equal(b.props.disabled,false);await act(async()=>b.props.onPress());};
  assert.equal(field().props.editable,false);
  assert.equal(button('Preparar briefing').props.disabled,true);
  assert.match(JSON.stringify(root.toJSON()),/Limite de 30 projetos/);
  // Even a stale callback must not allocate a new profile.
  await act(async()=>field().props.onChangeText('Pedido novo'));
  assert.equal(Object.keys(session.drafts).length,0);
  await press('Trocar projeto');
  assert.equal(button('Novo projeto em branco').props.disabled,true);
  await press('Projeto 0');
  assert.equal(field().props.editable,true);
  await act(async()=>field().props.onChangeText('Melhorar cadastro'));
  await press('Preparar briefing');
  assert.match(JSON.stringify(root.toJSON()),/Melhorar cadastro/);
  assert.deepEqual(Object.keys(session.drafts),['p-0']);
});
