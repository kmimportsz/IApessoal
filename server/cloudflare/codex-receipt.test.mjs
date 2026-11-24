import assert from 'node:assert/strict';
import {test} from 'node:test';
import {codexReviewReceipt,collectCodexComments} from './github.mjs';
import {directorReport} from './nexus.mjs';

const sha='a'.repeat(40),url='https://github.com/owner/repo/pull/8';
const make=(review,overrides={})=>({id:10,user:{id:199175422,login:'chatgpt-codex-connector[bot]',type:'Bot'},
  performed_via_github_app:{id:1144995,slug:'chatgpt-codex-connector'},updated_at:'2026-11-24T01:00:00Z',
  body:'<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 '+JSON.stringify({code_review:review})+' -->',...overrides});
const completed={commit_sha:sha,status:'completed',has_any_findings:true,has_unresolved_findings:true};

test('Recibo Codex só aceita metadados do bot e SHA atual',()=>{
  const c=make(completed);
  assert.deepEqual(codexReviewReceipt([c],sha,url),{state:'completed',commit:sha,url:url+'#issuecomment-10',findings:true,unresolved:true});
  assert.deepEqual(codexReviewReceipt([make({...completed,status:'running'})],sha,url),{state:'running',commit:sha,url:url+'#issuecomment-10'});
  assert.deepEqual(codexReviewReceipt([make(completed,{user:{...c.user,id:123}})],sha,url),{state:'not_observed'});
  assert.deepEqual(codexReviewReceipt([make(completed,{performed_via_github_app:null})],sha,url),{state:'not_observed'});
  assert.deepEqual(codexReviewReceipt([c], 'b'.repeat(40),url),{state:'stale'});
  assert.deepEqual(codexReviewReceipt([make({...completed,has_any_findings:false})],sha,url),{state:'unavailable'});
  assert.deepEqual(codexReviewReceipt([c,make({...completed,commit_sha:'b'.repeat(40)},{id:11,updated_at:'2026-11-24T01:10:00Z'})],sha,url),{state:'stale'});
  assert.deepEqual(codexReviewReceipt(null,sha,url),{state:'unavailable'});
});

test('Diretora distingue recibo de revisão e apontamentos não resolvidos de aprovação',()=>{
  const codex=codexReviewReceipt([make(completed)],sha,url);
  const report=directorReport({repo:'owner/repo',commit:sha,ci:'passed',prUrl:url,codex,checks:[],files:[]},1);
  assert.ok(report.verified.some(x=>x.text.includes('Codex: revisão registrada')));
  assert.ok(report.hypotheses.some(x=>x.text.includes('não resolvidos')));
  assert.equal(report.model.state,'not_requested');
  assert.equal(report.approved,undefined);
  const stale=directorReport({repo:'owner/repo',commit:sha,ci:'passed',prUrl:url,codex:{state:'stale'}},1);
  assert.equal(stale.verified.some(x=>x.text.includes('Codex')),false);
});

test('Recibo da segunda página é observado; paginação incompleta não confirma revisão',async()=>{
  const first=Array.from({length:50},(_,i)=>({id:i+100}));
  const actual=make(completed);
  const pages=await collectCodexComments(async page=>page===1?first:[actual]);
  assert.equal(codexReviewReceipt(pages,sha,url).state,'completed');
  const partial=await collectCodexComments(async()=>first,2);
  assert.equal(codexReviewReceipt(partial,sha,url).state,'unavailable');
});