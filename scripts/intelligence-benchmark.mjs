import {readFileSync} from 'node:fs';
import {blindWorksheet,compareBenchmark} from '../server/cloudflare/intelligence-benchmark.mjs';
const [mode,file]=process.argv.slice(2);
if(mode==='prepare')console.log(JSON.stringify(blindWorksheet(),null,2));
else if(mode==='compare'&&file){
 try{const result=compareBenchmark(JSON.parse(readFileSync(file,'utf8')));console.log(JSON.stringify(result,null,2));if(!result.eligibleForReview)process.exitCode=2;}
 catch(error){console.error(error.message);process.exitCode=1;}
}else{console.error('Uso: node scripts/intelligence-benchmark.mjs prepare | compare avaliacao.json');process.exitCode=1;}
