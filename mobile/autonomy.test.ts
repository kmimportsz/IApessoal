import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeActions } from './autonomy.ts';

const t = 1800000000000;
const finding=(id:string,priority:string,confidence='alta',state='new',path='auth.ts',line=14)=>({
  id,repo:1,created:t,finding_state:state,
  finding:{priority,confidence,path,line,problem:'Possivel inconsistencia verificavel'},
});

test('nao oferece itens resolvidos, sem evidencia ou sem consentimento vigente',()=>{
  const input=[finding('a','crítica','alta','resolved'),finding('b','alta','alta','new','',1),finding('c','alta')];
  assert.deepEqual(prioritizeActions(input,[],t).map(x=>x.id),['c']);
});

test('ordena criticidade com confianca e mistura revisoes existentes',()=>{
  const input=[finding('mid','média'),finding('high','alta'),finding('critical','crítica')];
  input[1].finding.path='stock.ts';input[2].finding.path='billing.ts';
  const reviews=[{run_id:'p',project_id:'project',created:t,state:'ready',summary:'Revisado',action:'Rever plano'}];
  assert.deepEqual(prioritizeActions(input,reviews,t,4).map(x=>x.id),['critical','high','mid','p']);
});

test('deduplica mesmo arquivo e mesma linha',()=>{
  const output=prioritizeActions([finding('a','alta'),finding('b','alta')],[],t);
  assert.equal(output.length,1);
});

test('nao trata analise silenciosa ou inconclusiva como acao',()=>{
  const reviews=[
    {run_id:'x',project_id:'p',state:'quiet',created:t,summary:'nada',action:'nada'},
    {run_id:'y',project_id:'p',state:'ready',created:t,summary:'conteudo',action:''},
  ];
  assert.deepEqual(prioritizeActions([],reviews,t),[]);
});

test('limita a quantidade de alertas de modo deterministico',()=>{
  const input=Array.from({length:10},(_,i)=>finding(String(i),'alta','alta','new','f'+i+'.ts'));
  assert.equal(prioritizeActions(input,[],t,3).length,3);
});

test('duplicatas preservam a evidência de maior criticidade',()=>{
  const input=[finding('media','média'),finding('critica','crítica')];
  assert.deepEqual(prioritizeActions(input,[],t).map(x=>x.id),['critica']);
});

test('iniciativa agrupa ações equivalentes sem misturar projetos',()=>{
  const base={run_id:'a',project_id:'p',created:t-100,state:'ready',summary:'Revisado',action:'Rever orçamento'};
  const reviews=[base,{...base,run_id:'b',created:t,action:'  REVER ORCAMENTO '},
    {...base,run_id:'c',project_id:'outro'}, {...base,run_id:'futuro',created:t+1}];
  assert.deepEqual(prioritizeActions([],reviews,t,5).map(x=>x.id),['b','c']);
});
