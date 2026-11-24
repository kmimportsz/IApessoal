import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const api=vm.runInNewContext(source+';({rank,validate,leaders,sensitivity})');
const d={title:'Decisão',criteria:[{name:'Custo',weight:50},{name:'Retorno',weight:50}],alternatives:[{name:'A',scores:[8,2]},{name:'B',scores:[2,8]}]};
test('Normalização mantém nota entre 0 e 10 e não depende da escala de pesos',()=>{
 const x=structuredClone(d);x.criteria[0].weight=75;x.criteria[1].weight=25;
 assert.equal(api.rank(x)[0].score,6.5);
 x.criteria[0].weight=30;x.criteria[1].weight=10;
 assert.equal(api.rank(x)[0].score,6.5);
});
test('Empates não escolhem vencedor arbitrário',()=>{assert.equal(api.leaders(api.rank(d)).length,2);});
test('Sensibilidade altera liderança quando se aumenta um dos critérios',()=>{const s=api.sensitivity(d);assert.equal(s[0].next,60);assert.equal(s[0].winners[0],'A');assert.equal(s[1].winners[0],'B');assert.equal(s[0].changed,true);});
test('Rejeita valores fora da faixa, campos vazios, pesos zerados e dados corrompidos',()=>{
 for(const mutate of [x=>x.criteria.forEach(c=>c.weight=0),x=>x.criteria[0].weight=-1,x=>x.alternatives[0].scores[0]=11,x=>x.alternatives[0].scores[0]=null,x=>x.criteria[0].name='',x=>x.alternatives[0].scores.pop()]){
 const x=structuredClone(d);mutate(x);assert.throws(()=>api.rank(x));}
});
test('Critério único com peso total mantém resultado e simulação',()=>{const x={title:'',criteria:[{name:'Qualidade',weight:100}],alternatives:[{name:'A',scores:[10]},{name:'B',scores:[0]}]};assert.equal(api.rank(x)[0].score,10);assert.equal(api.sensitivity(x)[0].changed,false);});
test('Documento autônomo, sem scripts, estilos ou recursos externos',()=>{assert.doesNotMatch(html,/<script[^>]*\bsrc=|<link[^>]*\bhref=|\bfetch\(|XMLHttpRequest|https?:\/\//i);});
