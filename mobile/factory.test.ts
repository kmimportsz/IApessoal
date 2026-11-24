import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyProfile,saveProfile,decodeProfiles,buildPrompt} from './factory.ts';
const a={...emptyProfile('a'),name:'Projeto A',purpose:'Atender clientes',visual:'Vermelho e branco',preferences:'Mobile first'};
const b={...emptyProfile('b'),name:'Projeto B',purpose:'Agendar serviços',visual:'Verde e preto',preferences:'Fluxo acessível'};
test('Perfis separados e edição preserva outro projeto',()=>{
  const list=saveProfile(saveProfile([],a),b);
  const updated=saveProfile(list,{...a,visual:'Azul'});
  assert.equal(updated.length,2);
  assert.equal(updated[1].visual,b.visual);
  assert.equal(list[0].visual,a.visual);
  const prompt=buildPrompt(updated[0],'Melhorar cadastro');
  assert.match(prompt,/Azul/);
  assert.doesNotMatch(prompt,/Verde e preto|Agendar serviços/);
});
test('Persistência serializada preserva preferências e rejeita dados inválidos',()=>{
  assert.deepEqual(decodeProfiles(JSON.stringify([a,b])),[a,b]);
  assert.throws(()=>decodeProfiles(JSON.stringify([a,a])));
  assert.throws(()=>decodeProfiles('{'));
  assert.throws(()=>saveProfile([],{...a,name:''}));
  assert.deepEqual(decodeProfiles(null),[]);
});
test('Briefing explicita pedido, identidade, agentes e limites',()=>{
  const prompt=buildPrompt(a,'Criar painel');
  for(const text of ['Criar painel','Vermelho e branco','Mobile first','ChatGPT','Codex','IA Pessoal','Fundador','Não definido','rollback'])assert.ok(prompt.includes(text));
  assert.throws(()=>buildPrompt(a,'   '));
  assert.throws(()=>buildPrompt(a,'x'.repeat(2001)));
});
