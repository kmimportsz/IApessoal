export const claimJobSql = `
  UPDATE outbox SET state='sending', url=? WHERE id=? AND state='queued'
  AND (memory_id IS NULL OR EXISTS (
    SELECT 1 FROM memory WHERE id=outbox.memory_id AND private=0 AND version=outbox.memory_version
  ))`;
