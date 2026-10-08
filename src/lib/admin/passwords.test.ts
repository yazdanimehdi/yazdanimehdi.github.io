import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './passwords';

test('hash → verify round trip; wrong password and malformed hashes fail', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.match(stored, /^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('correct horse batterx', stored), false);
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(await verifyPassword('anything', 'scrypt$1$1$1$a$b'), false);
});

test('two hashes of one password differ (random salt)', async () => {
  assert.notEqual(await hashPassword('same password 12'), await hashPassword('same password 12'));
});

test('policy: 12–200 characters, strings only', () => {
  assert.equal(assertPasswordPolicy('x'.repeat(12)), 'x'.repeat(12));
  for (const bad of ['x'.repeat(11), 'x'.repeat(201), 42, undefined]) {
    assert.throws(() => assertPasswordPolicy(bad), /Passwords must be 12–200 characters/);
  }
});
