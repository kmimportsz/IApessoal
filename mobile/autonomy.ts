/**
 * Autonomia supervisionada: triagem de evidencias e acoes ja autorizadas.
 * Nao altera projetos, nao cria permissao e nao executa inferencia.
 */
export type GitHubSignal = {
  id:string; repo:number; created:number; finding_state?:string;
  finding?:{priority:string;confidence:string;path:string;line:number;problem:string};
};
export type ProjectSignal = {
  run_id:string;project_id:string;created:number;state:string;
  title?:string;summary?:string;action?:string;
};
export type PriorityItem = {kind:'github'|'project';id:string;score:number;reason:string};

const risk:Record<string,number> = {'crítica':100,'alta':74,'média':48,'baixa':14,'oportunidade':8};
const assurance:Record<string,number> = {'alta':12,'média':3,'baixa':-14};

/** Prioriza somente descobertas e analises persistidas, nunca hipoteticas. */
export function prioritizeActions(
  github:GitHubSignal[], reviews:ProjectSignal[], now=Date.now(), limit=3,
):PriorityItem[] {
  const candidates:PriorityItem[]=[];
  const seen = new Set<string>();
  for (const run of github) {
    const finding=run.finding;
    if(run.finding_state!=='new'||!finding || !finding.path.trim() ||
       !Number.isSafeInteger(finding.line)||finding.line<=0 ||
       !finding.problem.trim() || !Object.hasOwn(risk,finding.priority)) continue;
    const key='gh:'+run.repo+':'+finding.path+':'+finding.line;
    if(seen.has(key))continue;
    seen.add(key);
    const age=Number.isFinite(now-run.created) ? Math.max(0,now-run.created) : 365*86400000;
    const freshness=age<=7*86400000?6:age<=30*86400000?2:0;
    const confidence=assurance[finding.confidence]??-14;
    candidates.push({kind:'github',id:run.id,score:risk[finding.priority]+confidence+freshness,
      reason:finding.priority==='crítica'?'Risco crítico requer revisão humana':'Descoberta pendente com evidência de arquivo'});
  }
  for (const review of reviews) {
    if(review.state!=='ready'||!review.summary?.trim()||!review.action?.trim())continue;
    const age=Number.isFinite(now-review.created)?Math.max(0,now-review.created):365*86400000;
    const freshness=age<=7*86400000?6:age<=30*86400000?2:0;
    candidates.push({kind:'project',id:review.run_id,score:46+freshness,
      reason:'Ação proposta em análise autorizada'});
  }
  return candidates.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id))
    .slice(0,Math.max(0,Math.min(5,Math.trunc(limit)||0)));
}
