import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyProfile,saveProfile,decodeProfiles,buildPrompt,mergeProfiles,validPalette,addLesson,designPalettes} from './factory.ts';
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

test('Laboratório protege versão principal e mantém design sob decisão do fundador',()=>{
  const prompt=buildPrompt(a,'Não gostei do cadastro','change');
  for(const text of ['Laboratório de alterações','SHA confirmado','não altere a branch principal','antes/depois','rollback','Design, layout e briefing finais','aprovação explícita'])assert.ok(prompt.includes(text));
  assert.match(buildPrompt(a,'Novo site','new'),/Expanda o pedido mínimo/);
});
test('Backup preserva perfis distintos e não sobrescreve perfil existente',()=>{
  const restored=decodeProfiles(JSON.stringify([a,b]));
  const local={...a,visual:'Atualizado localmente'};
  assert.deepEqual(mergeProfiles([local],restored),[local,b]);
  assert.deepEqual(mergeProfiles([],restored),[a,b]);
});

test('Studio registra paleta provisória e Knowledge mantém lições isoladas e restauráveis',()=>{
 const palette=designPalettes[0].palette;
 const lesson={observation:'Teste anterior falhou',action:'Testar cadastro novamente',reference:'https://github.com/owner/repo/pull/1'};
 const profile=addLesson({...a,design:palette},lesson);
 assert.equal(validPalette(palette),true);assert.equal(validPalette({...palette,accent:'red'}),false);
 assert.deepEqual(decodeProfiles(JSON.stringify([profile,b])),[profile,b]);
 const prompt=buildPrompt(profile,'Criar tela');
 assert.match(prompt,/não é aprovação final/);assert.match(prompt,/Testar cadastro novamente/);
 assert.doesNotMatch(buildPrompt(b,'Criar tela'),/Testar cadastro novamente/);
 assert.throws(()=>addLesson(a,{...lesson,reference:'https://user:pass@example.com/'}));
});
