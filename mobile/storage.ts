import type { SQLiteDatabase } from 'expo-sqlite';

export const schema = `
    PRAGMA journal_mode=WAL;
    PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS memory(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL,
      private INTEGER NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS outbox(
      id TEXT PRIMARY KEY, prompt TEXT NOT NULL, route TEXT NOT NULL, url TEXT NOT NULL,
      created INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'queued', reply TEXT
    );
    CREATE TABLE IF NOT EXISTS audit(
      id INTEGER PRIMARY KEY, created INTEGER NOT NULL, event TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS options(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS experiments(id INTEGER PRIMARY KEY, result TEXT NOT NULL);
`;

export const additions = {
  recovery_state: 'ALTER TABLE outbox ADD COLUMN recovery_state TEXT',
  response_model: 'ALTER TABLE outbox ADD COLUMN response_model TEXT',
  reply_at: 'ALTER TABLE outbox ADD COLUMN reply_at INTEGER',
  memory_id: 'ALTER TABLE outbox ADD COLUMN memory_id TEXT',
  memory_version: 'ALTER TABLE outbox ADD COLUMN memory_version INTEGER',
} as const;

export const historySchema = `
    CREATE TABLE IF NOT EXISTS memory_history(
      memory_id TEXT NOT NULL, version INTEGER NOT NULL, changed INTEGER NOT NULL,
      PRIMARY KEY(memory_id, version)
    );
    CREATE TRIGGER IF NOT EXISTS record_memory_version AFTER UPDATE OF version ON memory
      WHEN NEW.version != OLD.version
      BEGIN INSERT INTO memory_history VALUES (NEW.id, NEW.version, NEW.updated); END;
    CREATE TRIGGER IF NOT EXISTS delete_memory_versions AFTER DELETE ON memory
      BEGIN DELETE FROM memory_history WHERE memory_id=OLD.id; END;
    UPDATE outbox SET state='uncertain' WHERE state='sending';
`;

export async function initialize(db: SQLiteDatabase) {
  await db.execAsync(schema);
  await db.withExclusiveTransactionAsync(async tx => {
    const columns = new Set((await tx.getAllAsync<{name: string}>('PRAGMA table_info(outbox)')).map(col => col.name));
    for (const [column, sql] of Object.entries(additions)) {
      if (!columns.has(column)) await tx.execAsync(sql);
    }
    await tx.execAsync(historySchema);
  });
}

export function audit(db: SQLiteDatabase, event: string) {
  return db.runAsync('INSERT INTO audit(created,event) VALUES (?,?)', Date.now(), event);
}
