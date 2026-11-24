type Cursor={mission:{id:string;status:string};version:number};
const syncStates=['IMPLEMENTING','CI_PENDING','AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER'];
const auditStates=['AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER'];
export function canReview(status:string,pr?:string|null){return !!pr&&syncStates.includes(status);}
export async function reviewCycle<T extends Cursor>(initial:T,post:(cursor:T,type:'sync'|'audit')=>Promise<T>):Promise<T>{
  if(!syncStates.includes(initial.mission.status))throw Error('Esta missão não pode ser sincronizada.');
  const next=await post(initial,'sync');
  if(!auditStates.includes(next.mission.status))return next;
  return post(next,'audit');
}
export function nextAction(status:string,pr?:string|null){
  if(status==='IDEA')return 'Conferir e confirmar o briefing.';
  if(status==='SPEC_READY')return 'Iniciar a implementação autorizada no Codex.';
  if(status==='IMPLEMENTING'&&!pr)return 'Vincular o PR produzido na branch autorizada.';
  if(status==='CI_PENDING')return 'Aguardar testes e atualizar a entrega.';
  if(['IMPLEMENTING','AI_AUDIT'].includes(status))return 'Conferir GitHub e gerar relatório da Diretora.';
  if(status==='EVIDENCE_MISSING')return 'Conferir as evidências pendentes; registrar testes reais.';
  if(status==='CHANGES_REQUIRED')return 'Corrigir em ambiente isolado e apresentar novo commit.';
  if(status==='READY_FOR_OWNER')return 'Você decide se aprova a entrega e o design final.';
  if(status==='OWNER_APPROVED')return 'Aprovação registrada. Publicação é uma ação separada.';
  return 'Consulte o histórico e o estado da missão.';
}
export function deliverySummary(missions:{status:string}[]){
  return {total:missions.length,working:missions.filter(m=>['IDEA','SPEC_READY','IMPLEMENTING','CI_PENDING','AI_AUDIT'].includes(m.status)).length,
    pending:missions.filter(m=>['EVIDENCE_MISSING','CHANGES_REQUIRED','PAUSED','FAILED'].includes(m.status)).length,
    decisions:missions.filter(m=>m.status==='READY_FOR_OWNER').length,approved:missions.filter(m=>['OWNER_APPROVED','RELEASED'].includes(m.status)).length};
}
