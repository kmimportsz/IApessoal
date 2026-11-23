const hour = 3_600_000;
const day = hour * 24;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

const optIn = "EXISTS (SELECT 1 FROM tracking_settings WHERE singleton=1 AND enabled=1)";
export async function reviewProjects(db, now) {
  // One receipt per explicitly scheduled review. No model inference or external search.
  const result = await db.prepare(`
    INSERT OR IGNORE INTO initiative_events(project_id,occurred,due)
    SELECT p.id,?1,p.due FROM tracked_projects p
    WHERE p.active=1 AND p.due<=?1 AND NOT EXISTS (SELECT 1 FROM project_details_v14 d WHERE d.project_id=p.id AND d.status!='active') AND (p.demo=1 OR ${optIn})
      AND NOT EXISTS (SELECT 1 FROM initiative_events i WHERE i.project_id=p.id)
    ORDER BY p.due LIMIT 10
  `).bind(now).run();
  await db.prepare(`
    WITH due_slots AS (
      SELECT p.id,p.due,d.frequency_days*86400000 AS interval,
        CAST((?1-p.due)/(d.frequency_days*86400000) AS INTEGER) AS slot
      FROM tracked_projects p JOIN project_details_v14 d ON d.project_id=p.id
      WHERE p.active=1 AND d.status='active' AND d.frequency_days>0
      AND (?1-p.due)>=d.frequency_days*86400000 AND ${optIn}
    )
    INSERT OR IGNORE INTO recurring_reviews_v14(project_id,slot,occurred,due)
    SELECT id,slot,?1,due+slot*interval FROM due_slots
      WHERE NOT EXISTS(SELECT 1 FROM recurring_reviews_v14 e WHERE e.project_id=due_slots.id AND e.slot=due_slots.slot)
    ORDER BY due LIMIT 10
  `).bind(now).run();
  return result.meta?.changes;
}

function json(value, status = 200) {
  return Response.json(value, {status, headers:{'Cache-Control':'no-store'}});
}
function failure(error, status) { return json({error}, status); }

export async function initiativeRoute({path, method, db, read, now, enqueue}) {
  if (path === '/initiative' && method === 'GET') {
    const [permission, projects, initiatives] = await Promise.all([
      db.prepare('SELECT enabled FROM tracking_settings WHERE singleton=1').first(),
      db.prepare(`SELECT p.id,p.title,p.pending,p.due,p.active,d.description,d.objective,d.priority,d.status,
        COALESCE(d.frequency_days,0) AS frequencyDays
        FROM tracked_projects p LEFT JOIN project_details_v14 d ON p.id=d.project_id WHERE p.demo=0 ORDER BY p.due LIMIT 50`).all(),
      db.prepare(`SELECT id,occurred,due,state,title,pending,cycle FROM (
        SELECT i.project_id AS id,i.occurred,i.due,i.state,p.title,p.pending,0 AS cycle
        FROM initiative_events i JOIN tracked_projects p ON p.id=i.project_id WHERE p.demo=0
        UNION ALL
        SELECT i.project_id,i.occurred,i.due,i.state,p.title,p.pending,i.slot
        FROM recurring_reviews_v14 i JOIN tracked_projects p ON p.id=i.project_id WHERE p.demo=0
      ) ORDER BY occurred DESC LIMIT 50`).all(),
    ]);
    return json({enabled: permission?.enabled === 1, projects: projects.results,
      initiatives: initiatives.results.map(row => ({
        ...row, urgency: row.occurred - row.due >= day ? 'vencida' : 'na data',
        confidence:'data e pendência cadastradas', origin:'revisão agendada', action:'revisar pendência',
      }))});
  }
  if (path === '/initiative/permission' && method === 'POST') {
    const body = await read(128);
    if (typeof body?.enabled !== 'boolean') return failure('Permissão inválida.', 400);
    await db.prepare('INSERT INTO tracking_settings VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled')
      .bind(Number(body.enabled)).run();
    return json({enabled: body.enabled});
  }
  if (path === '/initiative/projects' && method === 'POST') {
    const value = await read(2048);
    const title = typeof value?.title === 'string' ? value.title.trim() : '';
    const pending = typeof value?.pending === 'string' ? value.pending.trim() : '';
    if (!uuid.test(value?.id ?? '') || !title || title.length > 80 || !pending || pending.length > 240 ||
      !Number.isSafeInteger(value.due) || value.due < now + 10_000 || value.due > now + 365 * day) {
      return failure('Informe um título, uma pendência e uma data futura válida.', 400);
    }
    const created = await db.prepare(`
      INSERT INTO tracked_projects(id,title,pending,due)
      SELECT ?,?,?,? WHERE ${optIn}
      AND (SELECT COUNT(*) FROM tracked_projects WHERE demo=0 AND active=1)<30
      ON CONFLICT(id) DO NOTHING RETURNING id
    `).bind(value.id,title,pending,value.due).first();
    if (!created) return failure('Ative o acompanhamento ou pause um objetivo antes de continuar.',409);
    const delay = Math.ceil((value.due - now) / 1000);
    if (enqueue && delay <= 86400) {
      try { await enqueue(delay); } catch { /* The periodic review can pick up this project. */ }
    }
    return json(created,201);
  }
  if (path === '/initiative/details' && method === 'POST') {
    const value = await read(4096);
    if (!uuid.test(value?.id ?? '') || !['active','paused','done'].includes(value.status) ||
        !['normal','high'].includes(value.priority) || ![0,1,7,30].includes(value.frequencyDays) ||
        typeof value.description!=='string' || value.description.length>500 ||
        typeof value.objective!=='string' || value.objective.length>240) return failure('Detalhes de projeto inválidos.',400);
    const row=await db.prepare(`
      INSERT INTO project_details_v14(project_id,description,objective,priority,status,frequency_days)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tracked_projects WHERE id=? AND demo=0) AND ${optIn}
      ON CONFLICT(project_id) DO UPDATE SET description=excluded.description, objective=excluded.objective,
        priority=excluded.priority,status=excluded.status,frequency_days=excluded.frequency_days
      RETURNING project_id
    `).bind(value.id,value.description.trim(),value.objective.trim(),value.priority,value.status,value.frequencyDays,value.id).first();
    return row ? json(row) : failure('Projeto não disponível ou acompanhamento pausado.',409);
  }
  if (path === '/initiative/projects' && method === 'PATCH') {
    const value = await read(160);
    if (!uuid.test(value?.id ?? '') || typeof value.active !== 'boolean') return failure('Alteração inválida.',400);
    const updated = await db.prepare(`UPDATE tracked_projects SET active=? WHERE id=? AND demo=0
      AND (?=0 OR NOT EXISTS(SELECT 1 FROM project_details_v14 d WHERE d.project_id=tracked_projects.id AND d.status!='active'))
      AND (active=? OR ?=0 OR (SELECT COUNT(*) FROM tracked_projects WHERE demo=0 AND active=1)<30) RETURNING id`)
      .bind(Number(value.active),value.id,Number(value.active),Number(value.active),Number(value.active)).first();
    return updated ? json(updated) : failure('Objetivo indisponível ou limite de objetivos ativos atingido.',409);
  }
  if (path === '/initiative/projects' && method === 'DELETE') {
    const value = await read(128);
    if (!uuid.test(value?.id ?? '')) return failure('Identificador inválido.',400);
    await db.prepare('DELETE FROM tracked_projects WHERE id=? AND demo=0').bind(value.id).run();
    return json({ok:true});
  }
  if (path === '/initiative/events' && method === 'POST') {
    const value = await read(160);
    if (!uuid.test(value?.id ?? '') || !['read','dismissed'].includes(value.state)) return failure('Alteração inválida.',400);
    if (Number.isSafeInteger(value.cycle) && value.cycle>0) {
      await db.prepare('UPDATE recurring_reviews_v14 SET state=? WHERE project_id=? AND slot=? AND EXISTS (SELECT 1 FROM tracked_projects WHERE id=? AND demo=0)')
        .bind(value.state,value.id,value.cycle,value.id).run();
    } else {
      await db.prepare('UPDATE initiative_events SET state=? WHERE project_id=? AND EXISTS (SELECT 1 FROM tracked_projects WHERE id=? AND demo=0)')
        .bind(value.state,value.id,value.id).run();
    }
    return json({ok:true});
  }
  return failure('Rota inexistente.',404);
}
