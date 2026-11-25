import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const files=new Map();
const root=resolve(process.argv[2]??'dist-release-check');
const meta=JSON.parse(readFileSync(resolve(root,'metadata.json'),'utf8'));
function check(name){
 if(typeof name!=='string'||!name.trim())throw Error('Caminho ausente no manifesto');
 const file=resolve(root,name);
 const rel=relative(root,file);
 if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('Caminho fora da exportação');
 const stat=statSync(file);
 if(!stat.isFile()||stat.size===0)throw Error('Arquivo ausente ou vazio: '+name);
 files.set(rel,{path:rel,bytes:stat.size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
 return stat.size;
}
for(const platform of ['ios','android']){
 const entry=meta.fileMetadata?.[platform];
 if(!entry||!Array.isArray(entry.assets))throw Error('Manifesto ausente para '+platform);
 const bytes=check(entry.bundle);
 for(const asset of entry.assets)check(asset.path);
 console.log(JSON.stringify({platform,bundle:entry.bundle,bytes,assets:entry.assets.length}));
}
check('metadata.json');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const head=process.env.IPE_PR_HEAD_SHA??sha;
if(!/^[a-f0-9]{40}$/.test(sha)||! /^[a-f0-9]{40}$/.test(head))throw Error('SHA inválido');
writeFileSync(resolve(root,'release-evidence.json'),JSON.stringify({schema:1,checkedOutSha:sha,prHeadSha:head,kind:'expo-export-not-native-build',files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
console.log('Bundles e assets conferidos; não equivale a build nativa assinada ou teste físico.');
