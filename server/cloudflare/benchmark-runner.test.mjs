import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkTarget,benchmarkRequest,verifySandbox,benchmarkReceipt} from './benchmark-runner.mjs';
const id='2177d36b-02d8-4cbb-88b0-88d1e401bc42';
test('runner aceita somente sandbox previsto e casos sintéticos',()=>{
 assert.equal(benchmarkTarget('https://iapessoal-sandbox-v162.km-prospect-ai-app.workers.dev/'),'https://iapessoal-sandbox-v162.km-prospect-ai-app.workers.dev');
 for(const url of ['https://iapessoal.km-prospect-ai-app.workers.dev','https://iapessoal-sandbox-v162.km-prospect-ai-app.workers.dev.evil.test','https://iapessoal-sandbox-v162.km-prospect-ai-app.workers.dev/?token=x'])
   assert.throws(()=>benchmarkTarget(url));
 assert.equal(benchmarkRequest('correction',id).route,'local');
 assert.throws(()=>benchmarkRequest('custom prompt',id));
});
test('runner não aceita produção, cota esgotada ou rota paga',()=>{
 const status={local:true,paid:false,dailyLimit:6,neuronLimit:950,dailyUsed:0,neuronsUsed:0};
 assert.doesNotThrow(()=>verifySandbox(status));
 assert.throws(()=>verifySandbox({...status,dailyLimit:100}));
 assert.throws(()=>verifySandbox({...status,dailyUsed:6}));
 assert.throws(()=>verifySandbox({...status,paid:true}));
});
test('só registra resposta recuperável do mesmo ID e com metadados reais',()=>{
 assert.throws(()=>benchmarkReceipt({id:'other'},id));
 assert.equal(benchmarkReceipt({id,state:'processing'},id).complete,false);
 assert.equal(benchmarkReceipt({id,state:'finished',reply:'texto'},id).complete,false);
 const value={id,state:'finished',recoverable:true,responseSource:'model',model:'fixture',reply:'texto',durationMs:1,neurons:2};
 assert.equal(benchmarkReceipt(value,id).complete,true);
 assert.equal(benchmarkReceipt({...value,responseSource:'tool'},id).complete,false);
});
