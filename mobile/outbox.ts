export const claimJobSql = `
  UPDATE outbox SET state='sending', url=? WHERE id=? AND state='queued'
  AND (memory_id IS NULL OR EXISTS (
    SELECT 1 FROM memory WHERE id=outbox.memory_id AND private=0 AND version=outbox.memory_version
  ))
  AND (memory_auto=0 OR EXISTS(
    SELECT 1 FROM memory_auto_grants WHERE id=outbox.memory_id AND version=outbox.memory_version
    UNION ALL SELECT 1 FROM memory_auto_scoped_grants g JOIN conversations c ON c.id=g.thread_id
    WHERE g.id=outbox.memory_id AND g.version=outbox.memory_version AND g.thread_id=outbox.thread_id AND c.archived=0
  ))`;
