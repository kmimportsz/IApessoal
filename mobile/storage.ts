import type { SQLiteDatabase } from 'expo-sqlite';

export async function initialize(db: SQLiteDatabase) {
  await db.execAsync(`
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
    UPDATE outbox SET state='uncertain' WHERE state='sending';
  `);
}

export function audit(db: SQLiteDatabase, event: string) {
  return db.runAsync('INSERT INTO audit(created,event) VALUES (?,?)', Date.now(), event);
}
