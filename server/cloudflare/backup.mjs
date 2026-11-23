import { idPattern } from './recovery.mjs';
const eventStates=['new','read','dismissed'];
const statusCodes=['active','paused','done'];
const text=(v,limit)=>typeof v==='string'&&v.length<=limit;
const millis=v=>Number.isSafeInteger(v)&&v>=0&&v<4102444800000;
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

export function validateProjects(value) {
  if(!value||!Array.isArray(value.projects)||!Array.isArray(value.events)||value.projects.length>100||value.events.length>500) throw Error('Backup de projetos inválido.');
  const ids=new Set();
  const projects=value.projects.map(p=>{
    if(!p||!idPattern.test(p.id??'')||ids.has(p.id)||!text(p.title,80)||!p.title.trim()||
       !text(p.pending,240)||!p.pending.trim()||!millis(p.due)||
       !text(p.description??'',500)||!text(p.objective??'',240)||
       !['normal','high'].includes(p.priority??'normal')||!statusCodes.includes(p.status??'active')||![0,1,7,30].includes(p.frequencyDays??0)) throw Error('Projeto inválido.');
    ids.add(p.id);
    return {id:p.id,title:p.title,pending:p.pending,due:p.due,description:p.description??'',objective:p.objective??'',
      priority:p.priority??'normal',status:p.status??'active',frequencyDays:p.frequencyDays??0};
  });
  const events=value.events.map(e=>{
    if(!e||!ids.has(e.id)||!Number.isInteger(e.cycle)||e.cycle<0||e.cycle>10000||
      !millis(e.due)||!millis(e.occurred)||!eventStates.includes(e.state)) throw Error('Iniciativa inválida.');
    return {id:e.id,cycle:e.cycle,due:e.due,occurred:e.occurred,state:e.state};
  });
  return {projects,events};
}

export async function backupRoute({db,method,read}) {
  if(method==='GET'){
    const projects=(await db.prepare(`
      SELECT p.id,p.title,p.pending,p.due,d.description,d.objective,d.priority,d.status,d.frequency_days AS frequencyDays
      FROM tracked_projects p LEFT JOIN project_details_v14 d ON d.project_id=p.id WHERE p.demo=0 LIMIT 101
    `).all()).results;
    const events=(await db.prepare(`
      SELECT id,cycle,due,occurred,state FROM (
        SELECT e.project_id AS id,0 AS cycle,e.due,e.occurred,e.state FROM initiative_events e JOIN tracked_projects p ON p.id=e.project_id WHERE p.demo=0
        UNION ALL
        SELECT e.project_id,e.slot,e.due,e.occurred,e.state FROM recurring_reviews_v14 e JOIN tracked_projects p ON p.id=e.project_id WHERE p.demo=0
      ) LIMIT 501
    `).all()).results;
    try{return response(validateProjects({projects,events}));}
    catch{return response({error:'O histórico de projetos excede o limite de exportação ou contém dados inválidos.'},409);}
  }
  if(method!=='POST') return response({error:'Método inválido.'},405);
  const value=await read(235_000);
  if(value?.confirmed!==true) return response({error:'Confirme a importação.'},400);
  let data;
  try{data=validateProjects(value);}catch(error){return response({error:error.message},400);}
  const known=(await db.prepare('SELECT id,title,pending FROM tracked_projects WHERE demo=0').all()).results;
  const keys=new Set(known.map(row=>(row.title+'\n'+row.pending).trim().toLowerCase()));
  const ids=new Set(known.map(row=>row.id));
  const filtered=data.projects.filter(row=>{
    const k=(row.title+'\n'+row.pending).trim().toLowerCase();
    if(ids.has(row.id)||keys.has(k)) return false;keys.add(k);return true;
  });
  const allowed=new Set(filtered.map(x=>x.id));
  const events=data.events.filter(x=>allowed.has(x.id));
  const p=JSON.stringify(filtered),e=JSON.stringify(events);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tracked_projects(id,title,pending,due,active)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.pending'),json_extract(value,'$.due'),0
      FROM json_each(?)`).bind(p),
    db.prepare(`INSERT OR IGNORE INTO project_details_v14(project_id,description,objective,priority,status,frequency_days)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.description'),json_extract(value,'$.objective'),
      json_extract(value,'$.priority'),'paused',json_extract(value,'$.frequencyDays') FROM json_each(?)`).bind(p),
    db.prepare(`INSERT OR IGNORE INTO initiative_events(project_id,occurred,due,state)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.occurred'),json_extract(value,'$.due'),'read'
      FROM json_each(?) WHERE json_extract(value,'$.cycle')=0`).bind(e),
    db.prepare(`INSERT OR IGNORE INTO recurring_reviews_v14(project_id,slot,occurred,due,state)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.cycle'),json_extract(value,'$.occurred'),json_extract(value,'$.due'),'read'
      FROM json_each(?) WHERE json_extract(value,'$.cycle')>0`).bind(e),
  ]);
  return response({imported:filtered.length,skipped:data.projects.length-filtered.length});
}
