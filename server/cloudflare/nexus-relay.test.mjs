import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('Executor rejeita pacote não autorizado e SHA divergente antes de chamar o Codex',t=>{
  const directory=mkdtempSync(join(tmpdir(),'nexus-relay-test-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  execFileSync('git',['init','-q',directory]);
  execFileSync('git',['-C',directory,'remote','add','origin','https://github.com/owner/repo.git']);
  const raw=JSON.stringify({schema:1,kind:'nexus.revision_request',delivery:'manual',
    missionId:'c0a00531-94df-4781-910e-f17ec2ac5581',repository:'owner/repo',branch:'nexus',
    revision:'1'.repeat(40),requests:[{location:'Formulário',why:'Rótulo ausente',expected:'Rótulo acessível',test:'Teste de interface'}]});
  const file=join(directory,'request.json');
  writeFileSync(file,raw);
  const relay=fileURLToPath(new URL('../../scripts/nexus-codex.mjs',import.meta.url));
  const call=digest=>spawnSync(process.execPath,[relay,file,digest,directory,directory],{encoding:'utf8'});
  const unauthorized=call('c'.repeat(64));
  assert.notEqual(unauthorized.status,0);
  assert.match(unauthorized.stderr,/hash não corresponde/);
  const stale=call(createHash('sha256').update(raw).digest('hex'));
  assert.notEqual(stale.status,0);
  assert.match(stale.stderr,/refs\/heads\/nexus|SHA autorizado/);
});

test('Pré-verificação testa gravação sem executar CLI ou alterar installation_id',async t=>{
  const {mkdirSync,readFileSync,readdirSync}=await import('node:fs');
  const {verifyExecutorPermissions}=await import('../../scripts/nexus-preflight.mjs');
  const root=mkdtempSync(join(tmpdir(),'nexus-preflight-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dirs={codexHome:join(root,'state'),gitDirectory:join(root,'git'),receipts:join(root,'receipts')};
  for(const dir of Object.values(dirs))mkdirSync(dir);
  await verifyExecutorPermissions(dirs);
  assert.deepEqual(readdirSync(dirs.codexHome),[]);
  const installation=join(dirs.codexHome,'installation_id');
  writeFileSync(installation,'identificador de teste');
  await verifyExecutorPermissions(dirs);
  assert.equal(readFileSync(installation,'utf8'),'identificador de teste');
  await assert.rejects(verifyExecutorPermissions({...dirs,receipts:join(root,'ausente')}),/diretório privado/);
  rmSync(installation);
  mkdirSync(installation);
  await assert.rejects(verifyExecutorPermissions(dirs),/installation_id/);
  await assert.rejects(verifyExecutorPermissions({...dirs,codexHome:join(root,'ausente')}),/CODEX_HOME/);
});
