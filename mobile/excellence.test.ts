import test from 'node:test';
import assert from 'node:assert/strict';
import {repositoryReadiness,buildExcellenceReviewRequest,buildObjectiveExcellenceRequest} from './excellence.ts';
const repo={id:1,name:'Minha Aplicacao',head:'a'.repeat(40),covered_files:10};
test('nao certifica codigo apenas por existir uma analise',()=>{
  const x=repositoryReadiness(repo,[]);
  assert.equal(x.state,'unverified');
  assert.match(x.explanation,/nao prova testes/);
});
test('risco critico nao resolvido bloqueia a entrega',()=>{
  const x=repositoryReadiness(repo,[{repo:1,commit_sha:repo.head,finding_state:'new',
    finding:{path:'app.tsx',line:23,problem:'Problema grave',priority:'crítica',confidence:'alta'}}]);
  assert.equal(x.state,'blocked');
});
test('achados resolvidos nao sao contabilizados como abertos',()=>{
  const x=repositoryReadiness(repo,[{repo:1,finding_state:'resolved',finding:{
    path:'app.tsx',line:1,problem:'Corrigido',priority:'alta',confidence:'alta'}}]);
  assert.equal(x.state,'unverified');
});
test('pedido para a diretoria distingue dados de instrucoes',()=>{
  const text=buildExcellenceReviewRequest(repo,[{repo:1,finding_state:'new',
    finding:{path:'auth.ts',line:3,problem:'Falha a investigar',priority:'média',confidence:'baixa'}}]);
  assert.match(text,/DADOS DE MONITORAMENTO/);
  assert.match(text,/EM REVISAO/);
  assert.match(text,/auth.ts/);
  assert.ok(text.length<=5000);
});
test('brief de objetivo nao divulga o repositorio de outros projetos',()=>{
  const text=buildObjectiveExcellenceRequest({title:'Projeto A',pending:'Criar interface'});
  assert.match(text,/Projeto A/);
  assert.match(text,/criterios claros de aceite/);
  assert.doesNotMatch(text,/Minha Aplicacao/);
});
