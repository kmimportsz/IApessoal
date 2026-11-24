import {benchmarkCases} from './intelligence-benchmark.mjs';

// One authorized case per invocation. No automatic retries or extra calls.
export function benchmarkTarget(raw){
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||
    !/^iapessoal-(?:sandbox|benchmark)-[a-z0-9-]+\.km-prospect-ai-app\.workers\.dev$/.test(u.hostname))
   throw Error('Use exclusivamente um gateway de sandbox autorizado da IA Pessoal.');
 return u.origin;
}
export function benchmarkRequest(caseId,id){
 const item=benchmarkCases.find(x=>x.id===caseId);
 if(!item||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id??''))throw Error('Caso ou ID inválido.');
 return {id,route:'local',prompt:item.prompt};
}
export function verifySandbox(status){
 if(status?.local!==true||status.paid!==false||status.dailyLimit!==6||status.neuronLimit!==950||
    !Number.isSafeInteger(status.dailyUsed)||status.dailyUsed<0||status.dailyUsed>=status.dailyLimit||
    !Number.isSafeInteger(status.neuronsUsed)||status.neuronsUsed<0||status.neuronsUsed>=status.neuronLimit)
   throw Error('Gateway não corresponde à cota isolada disponível.');
}
export function benchmarkReceipt(value,id){
 if(value?.id!==id)throw Error('Recibo divergente. Não repita a chamada.');
 if(value.state!=='finished'||value.recoverable!==true||typeof value.reply!=='string'||!value.reply.trim()||
    value.responseSource!=='model'||typeof value.model!=='string'||!value.model.trim()||
    !Number.isFinite(value.durationMs)||value.durationMs<0||!Number.isFinite(value.neurons)||value.neurons<0)
   return {id,state:typeof value.state==='string'?value.state:'unknown',complete:false};
 return {id,state:'finished',complete:true,model:value.model,durationMs:value.durationMs,neurons:value.neurons,reply:value.reply};
}
