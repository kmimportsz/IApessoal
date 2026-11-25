import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assessRequest,competencyChecks,contextualMemory,trustedResearchUrl} from './competence.ts';
import {relevantMemory,type Memory} from './core.ts';

test('Os casos determinísticos de competências passam sem chamar modelos',()=>{
  assert.equal(competencyChecks().length,8);
  for(const [domain,label,passed] of competencyChecks())assert.ok(passed,domain+' · '+label);
  assert.equal(assessRequest('Calcule 0,1+0,2').arithmetic?.decimal,'0,3');
  assert.equal(assessRequest('Calcule 1/3').arithmetic?.rounded,true);
  assert.equal(assessRequest('Calcule taxa sobre meu lucro').arithmetic,undefined);
  assert.equal(trustedResearchUrl('https://alice@doi.org/10.1/test'),false);
  assert.equal(trustedResearchUrl('https://doi.org:8443/10.1/test'),false);
});

test('Memória automática se abstém de decisões antigas, conflito e tema genérico',()=>{
  const now=1_800_000_000_000;
  const memory:Memory={id:'1',kind:'Projeto',body:'Catálogo Aurora usa SQLite',updated:now,private:0,version:1};
  assert.equal(contextualMemory('Como está o Catálogo Aurora?', [memory],now)?.id,'1');
  const old={...memory,updated:now-181*86400000};
  assert.equal(relevantMemory('Catálogo Aurora',[old])?.id,'1');
  assert.equal(contextualMemory('Catálogo Aurora',[old],now),undefined);
  assert.equal(contextualMemory('Catálogo Aurora',[memory,{...memory,id:'2',body:'Catálogo Aurora usa PostgreSQL'}],now),undefined);
  assert.equal(contextualMemory('Catálogo Aurora',[{...memory,private:1}],now),undefined);
  assert.equal(contextualMemory('app',[memory],now),undefined);
});

test('Memória evita conflito entre projeto e decisão e não usa metadados inválidos',()=>{
  const now=1_800_000_000_000;
  const base:Memory={id:'1',kind:'Projeto',body:'Catálogo Aurora usa SQLite',updated:now,private:0,version:1};
  const decision:Memory={...base,id:'2',kind:'Decisão',body:'Catálogo Aurora usa PostgreSQL'};
  assert.equal(contextualMemory('Catálogo Aurora',[base,decision],now),undefined);
  assert.equal(contextualMemory('Catálogo Aurora',[base,{...decision,private:1}],now)?.id,'1');
  assert.equal(contextualMemory('Catálogo Aurora',[{...base,updated:now+1}],now),undefined);
  assert.equal(contextualMemory('Catálogo Aurora',[{...base,version:0}],now),undefined);
});
