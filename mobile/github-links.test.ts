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
