import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initialize, schema } from './storage.ts';
import { claimJobSql } from './outbox.ts';

test('A migração 1.1 preserva v1.0, recupera envio e registra metadados de revisão', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(schema);
    sqlite.exec(`
      INSERT INTO memory VALUES ('legacy','Preferência','registro',0,100,1);
      INSERT INTO outbox VALUES ('old','mensagem','local','https://example.test',99,'sending',NULL);
      INSERT INTO outbox VALUES ('done','mensagem','local','https://example.test',98,'done','resposta');
      INSERT INTO experiments(result) VALUES ('resultado');
      INSERT INTO options VALUES ('search','2'),('avatarChoice','Explorador'),('avatarPhoto','avatar-00000000-0000-4000-8000-000000000001.jpg'),('voiceRate','0.8');
      INSERT INTO audit(created,event) VALUES (90, 'enviado');
    `);
    const connection = {
      execAsync: async (sql: string) => sqlite.exec(sql),
      getAllAsync: async (sql: string) => sqlite.prepare(sql).all(),
      withExclusiveTransactionAsync: async (action: (tx: unknown) => Promise<void>) => {
        sqlite.exec('BEGIN');
        try { await action(connection); sqlite.exec('COMMIT'); }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    await initialize(connection as unknown as Parameters<typeof initialize>[0]);
    await initialize(connection as unknown as Parameters<typeof initialize>[0]);
    assert.equal(sqlite.prepare("SELECT state FROM outbox WHERE id='old'").get()?.state, 'uncertain');
    assert.equal(sqlite.prepare("SELECT reply FROM outbox WHERE id='done'").get()?.reply, 'resposta');
    assert.equal(sqlite.prepare('SELECT result FROM experiments').get()?.result, 'resultado');
    assert.equal(sqlite.prepare("SELECT value FROM options WHERE key='search'").get()?.value, '2');
    assert.equal(sqlite.prepare("SELECT value FROM options WHERE key='avatarChoice'").get()?.value, 'Explorador');
    assert.equal(sqlite.prepare("SELECT value FROM options WHERE key='avatarPhoto'").get()?.value, 'avatar-00000000-0000-4000-8000-000000000001.jpg');
    assert.equal(sqlite.prepare("SELECT value FROM options WHERE key='voiceRate'").get()?.value, '0.8');
    assert.equal(sqlite.prepare('SELECT event FROM audit').get()?.event, 'enviado');
    assert.equal(sqlite.prepare('SELECT body FROM memory').get()?.body, 'registro');

    sqlite.exec("INSERT INTO outbox (id,prompt,route,url,created,memory_id,memory_version) VALUES ('a','a','local','',123,'legacy',1), ('b','b','local','',124,'legacy',1)");
    const claim = sqlite.prepare(claimJobSql);
    assert.equal(claim.run('https://example.test', 'a').changes, 1);
    assert.equal(claim.run('https://example.test', 'a').changes, 0);
    sqlite.exec("UPDATE memory SET private=1,version=2,updated=200 WHERE id='legacy'");
    assert.equal(claim.run('https://example.test', 'b').changes, 0);
    sqlite.exec("UPDATE memory SET private=0,version=3 WHERE id='legacy'");
    sqlite.exec("INSERT INTO memory_auto_grants VALUES ('legacy',3)");
    sqlite.exec("INSERT INTO outbox (id,prompt,route,url,created,memory_id,memory_version,memory_auto) VALUES ('c','c','local','',125,'legacy',3,1)");
    sqlite.exec("DELETE FROM memory_auto_grants WHERE id='legacy'");
    assert.equal(claim.run('https://example.test', 'c').changes,0);
    assert.equal(sqlite.prepare('SELECT version FROM memory_history ORDER BY version LIMIT 1').get()?.version, 2);
    sqlite.exec("DELETE FROM memory WHERE id='legacy'");
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM memory_history').get()?.count, 0);
  } finally { sqlite.close(); }
});
