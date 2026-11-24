import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canReview,reviewCycle,nextAction,deliverySummary} from './nexus-operations.ts';
const initial={mission:{id:'mission',status:'IMPLEMENTING'},version:5};
test('AutoPilot sincroniza e audita com versão devolvida pelo gateway',async()=>{
 const calls:string[]=[];
 const result=await reviewCycle(initial,async(cursor,type)=>{
  calls.push(type+':'+cursor.version);
  return {...cursor,version:cursor.version+1,mission:{...cursor.mission,status:type==='sync'?'AI_AUDIT':'EVIDENCE_MISSING'}};
 });
 assert.deepEqual(calls,['sync:5','audit:6']);assert.equal(result.version,7);assert.equal(result.mission.status,'EVIDENCE_MISSING');
});
test('AutoPilot não audita CI pendente, não aprova, não repete falhas',async()=>{
 let calls=0;
 const result=await reviewCycle(initial,async cursor=>{calls++;return {...cursor,mission:{...cursor.mission,status:'CI_PENDING'}};});
 assert.equal(calls,1);assert.equal(result.mission.status,'CI_PENDING');
 await assert.rejects(reviewCycle(initial,async()=>{throw Error('rede');}),/rede/);
 await assert.rejects(reviewCycle({...initial,mission:{id:'mission',status:'OWNER_APPROVED'}},async()=>{throw Error('não deve chamar');}),/não pode/);
 assert.equal(canReview('IMPLEMENTING',null),false);
 assert.equal(canReview('IMPLEMENTING','https://github.com/owner/repo/pull/1'),true);
});
test('Central conta estados reais e não sugere publicação automática',()=>{
 const rows=['IDEA','CI_PENDING','EVIDENCE_MISSING','CHANGES_REQUIRED','READY_FOR_OWNER','OWNER_APPROVED','CANCELLED'].map(status=>({status}));
 assert.deepEqual(deliverySummary(rows),{total:7,working:2,pending:2,decisions:1,approved:1});
 assert.match(nextAction('OWNER_APPROVED'),/Publicação é uma ação separada/);
 assert.match(nextAction('IMPLEMENTING',null),/Vincular/);
});
