import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { memoryKey, validateMemoryBackup, type Memory } from './core';
import {decodeProfiles,mergeProfiles} from './factory';
import { exportOptions, validateWorkspace, type Backup } from './backup-format';

export async function exportWorkspace(db:SQLiteDatabase, cloud:unknown) {
  const [memories,threads,messages,prefs]=await Promise.all([
    db.getAllAsync('SELECT * FROM memory LIMIT 501'),
    db.getAllAsync('SELECT id,title,archived FROM conversations LIMIT 101'),
    db.getAllAsync(`SELECT id,thread_id,prompt,reply,created,reply_at,response_model FROM outbox LIMIT 1001`),
    db.getAllAsync<{key:string;value:string}>('SELECT key,value FROM options'),
  ]);
  const options=Object.fromEntries(prefs.filter(r=>exportOptions.includes(r.key as typeof exportOptions[number])).map(r=>[r.key,r.value]));
  await db.execAsync('CREATE TABLE IF NOT EXISTS nexus_factory_profiles_v1 (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)');
  const factory=await db.getFirstAsync<{record:string}>('SELECT record FROM nexus_factory_profiles_v1 WHERE id=1');
  const factoryProfiles=decodeProfiles(factory?.record??null);
  const data=validateWorkspace({version:2,memories,threads,messages,options,cloud,factoryProfiles},validateMemoryBackup);
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  if(bytes.length>1_350_000) throw Error('O backup excede 1,35 MB. Nenhum registro foi descartado.');
  const key=await AESEncryptionKey.generate(256);
  const sealed=await aesEncryptAsync(bytes,key);
  return {key:await key.encoded('hex'),payload:'IPE15:'+await sealed.combined('base64')};
}
export async function readBackup(payload:string, hex:string):Promise<Backup> {
  if(!/^IPE1[45]:[A-Za-z0-9+/=]+$/.test(payload)||payload.length>1_810_000||!/^[a-f0-9]{64}$/i.test(hex))
    throw Error('Backup ou chave inválidos.');
  try{
    const key=await AESEncryptionKey.import(hex,'hex');
    const bytes=await aesDecryptAsync(AESSealedData.fromCombined(payload.slice(6)),key);
    const parsed=JSON.parse(new TextDecoder().decode(bytes));
    return payload.startsWith('IPE14:')?{version:2,memories:validateMemoryBackup(parsed),threads:[],messages:[],options:{},cloud:null}:
      validateWorkspace(parsed,validateMemoryBackup);
  }catch{throw Error('Não foi possível autenticar ou validar o backup.');}
}
export async function importWorkspace(db:SQLiteDatabase,data:Backup) {
  const counts={memories:0,messages:0,threads:0};
  await db.withExclusiveTransactionAsync(async tx=>{
    const existing=await tx.getAllAsync<Pick<Memory,'body'>>('SELECT body FROM memory');
    const keys=new Set(existing.map(row=>memoryKey(row.body)));
    for(const row of data.memories){
      const key=memoryKey(row.body);if(keys.has(key))continue;
      await tx.runAsync('INSERT INTO memory VALUES (?,?,?,?,?,1)',randomUUID(),row.kind,row.body,1,row.updated);
      keys.add(key);counts.memories++;
    }
    for(const row of data.threads){
      counts.threads+=(await tx.runAsync('INSERT OR IGNORE INTO conversations(id,title,archived) VALUES (?,?,?)',row.id,row.title,row.archived)).changes;
    }
    for(const row of data.messages){
      counts.messages+=(await tx.runAsync(`
        INSERT OR IGNORE INTO outbox(id,thread_id,prompt,route,url,created,state,reply,reply_at,response_model)
        VALUES (?,?,?,'local','',?,?,?,?,?)
      `,row.id,row.thread_id,row.prompt,row.created,row.reply?'done':'rejected',row.reply,row.reply_at,row.response_model)).changes;
    }
    if(data.factoryProfiles!==undefined){
      await tx.execAsync('CREATE TABLE IF NOT EXISTS nexus_factory_profiles_v1 (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)');
      const row=await tx.getFirstAsync<{record:string}>('SELECT record FROM nexus_factory_profiles_v1 WHERE id=1');
      const existing=decodeProfiles(row?.record??null);
      const merged=mergeProfiles(existing,data.factoryProfiles);
      await tx.runAsync('INSERT INTO nexus_factory_profiles_v1 (id,record) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record',JSON.stringify(merged));
    }
    for(const [k,v] of Object.entries(data.options))await tx.runAsync('INSERT OR IGNORE INTO options VALUES (?,?)',k,v);
  });
  return counts;
}
