import {readFileSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
const root=resolve(process.argv[2]??'dist-release-check');
const meta=JSON.parse(readFileSync(resolve(root,'metadata.json'),'utf8'));
function check(name){
 if(typeof name!=='string'||!name.trim())throw Error('Caminho ausente no manifesto');
 const file=resolve(root,name);
 const rel=relative(root,file);
 if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('Caminho fora da exportação');
 const stat=statSync(file);
 if(!stat.isFile()||stat.size===0)throw Error('Arquivo ausente ou vazio: '+name);
 return stat.size;
}
for(const platform of ['ios','android']){
 const entry=meta.fileMetadata?.[platform];
 if(!entry||!Array.isArray(entry.assets))throw Error('Manifesto ausente para '+platform);
 const bytes=check(entry.bundle);
 for(const asset of entry.assets)check(asset.path);
 console.log(JSON.stringify({platform,bundle:entry.bundle,bytes,assets:entry.assets.length}));
}
console.log('Bundles e assets conferidos; não equivale a build nativa assinada ou teste físico.');
