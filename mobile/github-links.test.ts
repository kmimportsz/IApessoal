import assert from 'node:assert/strict';
import {test} from 'node:test';
import {githubLink} from './github-links.ts';

test('links GitHub fixam origem, commit, arquivo e linha',()=>{
  const sha='a'.repeat(40);
  assert.equal(githubLink('owner/repo',sha,'src/App.tsx',18),'https://github.com/owner/repo/blob/'+sha+'/src/App.tsx#L18');
  assert.equal(githubLink('owner/repo',sha,'../outside'),undefined);
  assert.equal(githubLink('owner/repo',sha,'file%2fsecret'),undefined);
  assert.equal(githubLink('evil.example/repo?redirect=1',sha),undefined);
  assert.equal(githubLink('owner/repo','main','src/App.tsx'),undefined);
});

test('intervalos preservam a linha inicial e final em diretórios aninhados',()=>{
  const sha='b'.repeat(40);
  assert.equal(githubLink('kmimportsz/IApessoal',sha,'server/cloudflare/worker.mjs',12,27),
    'https://github.com/kmimportsz/IApessoal/blob/'+sha+'/server/cloudflare/worker.mjs#L12-L27');
  assert.match(githubLink('owner/private',sha,'src/main.ts',12,12)??'',/#L12$/);
  assert.equal(githubLink('owner/private',sha,'src/main.ts',12,10),undefined);
  assert.equal(githubLink('owner/private',sha,'src/main.ts',undefined,10),undefined);
});
