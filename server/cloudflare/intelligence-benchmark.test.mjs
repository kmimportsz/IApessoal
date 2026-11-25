import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkCases,benchmarkVersion,blindWorksheet,compareBenchmark} from './intelligence-benchmark.mjs';
const run=(name)=>({sha:'a'.repeat(40),model:'fixture',runId:name,durationMs:1});
const sample=()=>({version:benchmarkVersion,assignment:{baseline:'B',candidate:'A'},baseline:run('one'),candidate:run('two'),
 grades:benchmarkCases.map(c=>({id:c.id,A:c.criteria.map(()=>true),B:c.criteria.map(()=>false)}))});
test('benchmark exige avaliação explícita e não aprova publicação',()=>{
 const worksheet=blindWorksheet();
 assert.equal(worksheet.cases.length,10);
 assert.ok(worksheet.cases.every(x=>x.A===null&&x.B===null));
 const result=compareBenchmark(sample());
 assert.equal(result.candidate.passed,30);
 assert.equal(result.eligibleForReview,true);
 assert.equal('approved' in result,false);
});
test('falha crítica ou regressão bloqueia mesmo com ganho agregado',()=>{
 const data=sample();data.grades[0].A[0]=false;
 assert.equal(compareBenchmark(data).eligibleForReview,false);
 const other=sample();other.grades.at(-1).A[1]=false;other.grades.at(-1).B[1]=true;
 assert.equal(compareBenchmark(other).eligibleForReview,false);
});
test('rejeita avaliação incompleta, mapeamento duplicado e metadados ausentes',()=>{
 const data=sample();data.grades.pop();assert.throws(()=>compareBenchmark(data));
 assert.throws(()=>compareBenchmark({...sample(),assignment:{baseline:'A',candidate:'A'}}));
 assert.throws(()=>compareBenchmark({...sample(),candidate:{}}));
});
