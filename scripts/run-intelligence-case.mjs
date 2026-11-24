import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {benchmarkTarget,benchmarkRequest,verifySandbox,benchmarkReceipt} from '../server/cloudflare/benchmark-runner.mjs';
const [mode,file,caseId,sha]=process.argv.slice(2);
try{
 if(!['start','recover'].includes(mode)||!file)throw Error('Uso: start arquivo.json caso SHA | recover arquivo.json');
 const origin=benchmarkTarget(process.env.IPE_BENCHMARK_URL);
 const token=process.env.IPE_BENCHMARK_TOKEN;
 if(process.env.IPE_BENCHMARK_AUTHORIZED!=='yes'||!/^[A-Za-z0-9_-]{32,128}$/.test(token??''))throw Error('Autorize localmente o teste e configure a credencial do sandbox no ambiente.');
 const call=async(path,data)=>{
   const res=await fetch(origin+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
     body:data?JSON.stringify(data):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!res.ok)throw Error('Gateway HTTP '+res.status+'; consulte o mesmo recibo, não repita o envio.');
   return res.json();
 };
 let record;
 if(mode==='start'){
   if(!/^[a-f0-9]{40}$/i.test(sha??''))throw Error('Informe o SHA conferido pelo operador.');
   const body=benchmarkRequest(caseId,randomUUID());
   verifySandbox(await call('/status'));
   record={schema:1,origin,declaredSha:sha,caseId,id:body.id,createdAt:new Date().toISOString(),state:'submitted_unknown'};
   // Exclusive write BEFORE POST: on failure retain the ID; recover never sends again.
   writeFileSync(file,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
   const response=await call('/chat',body);
   if(response?.id!==record.id)throw Error('Recibo inicial divergente; não repita o envio.');
   record.state=response.state??'unknown';
   writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});
 }else{
   record=JSON.parse(readFileSync(file,'utf8'));
   if(record.schema!==1||record.origin!==origin||! /^[a-f0-9]{40}$/i.test(record.declaredSha??''))throw Error('Registro não pertence ao sandbox informado.');
   benchmarkRequest(record.caseId,record.id);
   const result=benchmarkReceipt(await call('/requests/'+record.id),record.id);
   record={...record,...result};
   writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});
 }
 console.log(JSON.stringify({id:record.id,caseId:record.caseId,state:record.state,complete:record.complete===true}));
}catch(error){console.error(error.message);process.exitCode=1;}
