import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDue, checkInterval } from './update-policy.ts';

test('checa ao iniciar e limita checagens consecutivas pelo horário persistido', () => {
  const last = 100_000;
  assert.equal(checkDue(last, NaN), true);
  assert.equal(checkDue(last, last), false);
  assert.equal(checkDue(last + checkInterval - 1, last), false);
  assert.equal(checkDue(last + checkInterval, last), true);
  assert.equal(checkDue(last - 1, last), true);
});
