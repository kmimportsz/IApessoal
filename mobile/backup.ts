import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { memoryKey, validateMemoryBackup, type Memory } from './core';

export async function exportMemories(memories: Memory[]) {
  validateMemoryBackup({version:1,memories});
  const key=await AESEncryptionKey.generate(256);
  const bytes=new TextEncoder().encode(JSON.stringify({version:1,memories}));
  if(bytes.length>450000) throw Error('Este backup excede o limite de 450 KB.');
  const sealed=await aesEncryptAsync(bytes,key);
  return {key:await key.encoded('hex'),payload:'IPE14:'+await sealed.combined('base64')};
}
export async function readBackup(payload: string, hex: string) {
  if(!/^IPE14:[A-Za-z0-9+/=]+$/.test(payload) || payload.length>610000 || !/^[a-f0-9]{64}$/i.test(hex)) throw Error('Backup ou chave inválidos.');
  try {
    const key=await AESEncryptionKey.import(hex,'hex');
    const bytes=await aesDecryptAsync(AESSealedData.fromCombined(payload.slice(6)),key);
    return validateMemoryBackup(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {throw Error('Não foi possível autenticar ou validar o backup. Confira a chave e o conteúdo.');}
}
export async function importMemories(db: SQLiteDatabase, items: Memory[]) {
  let imported=0;
  await db.withExclusiveTransactionAsync(async tx=>{
    const existing=await tx.getAllAsync<{body:string}>('SELECT body FROM memory');
    const keys=new Set(existing.map(row=>memoryKey(row.body)));
    for(const row of items){
      const key=memoryKey(row.body);
      if(keys.has(key)) continue;
      // Restored memories require renewed sharing approval on this device.
      await tx.runAsync('INSERT INTO memory VALUES (?,?,?,?,?,1)',randomUUID(),row.kind,row.body,1,row.updated);
      keys.add(key);imported++;
    }
  });
  return imported;
}
