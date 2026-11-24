import assert from 'node:assert/strict';
import {test} from 'node:test';
import {transition,validBrief} from './nexus.mjs';

const revision='1'.repeat(40);
const dimensions=['navegação','clareza','design','responsividade','acessibilidade','tarefas principais'];
const url='https://github.com/owner/repo';
const remote={commit:revision,ci:'passed'};
const brief={schema:1,id:'c0a00531-94df-4781-910e-f17ec2ac5581',repoId:1,issue:2,pr:null,baseRef:'main',branch:'nexus',
  objective:'Entregar um cadastro',checks:['Execução'],constraints:[],nonGoals:[],maxIterations:3,
  criteria:[{id:'task',description:'Concluir cadastro',expectedEvidence:'Teste funcional e gravação'}]};
const audit=()=>({status:'AI_AUDIT',revision,brief,remote,iteration:1,evidence:{},criteria:{},findings:[]});

test('Teste de Realidade é obrigatório e aprovação requer revisão e CI atuais',()=>{
  const base=audit();
  const attest=(mission,payload)=>transition(mission,{type:'attest',payload:{commit:revision,status:'passed',url,
    reason:'Evidência revisada manualmente pelo proprietário.',...payload}},null,1);
  let mission=base;
  for(const axis of ['objective','correctness','security','resilience','delivery'])mission=attest(mission,{axis});
  mission=attest(mission,{criterion:'task'});
  assert.equal(transition(mission,{type:'audit'},null,2).status,'EVIDENCE_MISSING');
  mission=attest(mission,{axis:'experience',dimensions,functionalUrl:url+'/actions',visualUrl:url+'/evidence'});
  const ready=transition(mission,{type:'audit'},null,2);
  assert.equal(ready.status,'READY_FOR_OWNER');
  assert.equal(ready.ownerApproval,null);
  const approve={type:'approve',payload:{commit:revision}};
  assert.throws(()=>transition(ready,approve,{commit:'2'.repeat(40),ci:'passed'},3));
  assert.throws(()=>transition(ready,approve,{commit:revision,ci:'failed'},3));
  const approved=transition(ready,approve,remote,3);
  assert.deepEqual(approved.ownerApproval,{commit:revision,at:3,actor:'owner'});
  assert.equal(approved.status,'OWNER_APPROVED');
});

test('Limite de revisões pausa a missão e o brief rejeita chave de protótipo',()=>{
  assert.equal(validBrief(brief),true);
  assert.equal(validBrief({...brief,criteria:[{...brief.criteria[0],id:'__proto__'}]}),false);
  assert.equal(transition({...audit(),status:'CHANGES_REQUIRED',iteration:3},{type:'start'},null,1).status,'PAUSED');
});
