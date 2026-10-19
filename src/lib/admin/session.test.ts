import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_TTL, openSession, sealSession, sessionSecret } from './session';

const SECRET = 'a'.repeat(32);
const user = { login: 'jane', name: 'Jane', avatar: 'https://avatars.example/x', provider: 'github' as const };

test('seal → open round trip', async () => {
  assert.deepEqual(await openSession(await sealSession(user, SECRET), SECRET), user);
});

test('tampered, wrong-key and malformed tokens are rejected', async () => {
  const token = await sealSession(user, SECRET);
  const i = token.length - 2;
  const flipped = token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
  assert.equal(await openSession(flipped, SECRET), null);
  assert.equal(await openSession(token, 'b'.repeat(32)), null);
  assert.equal(await openSession('not-a-token', SECRET), null);
  assert.equal(await openSession('', SECRET), null);
});

test('a payload without name or avatar opens with safe defaults', async () => {
  const token = await sealSession({ login: 'jane' } as never, SECRET);
  assert.deepEqual(await openSession(token, SECRET), { login: 'jane', name: 'jane', avatar: '', provider: 'github' });
  const odd = await sealSession({ login: 'jane', name: 5, avatar: { x: 1 } } as never, SECRET);
  assert.deepEqual(await openSession(odd, SECRET), { login: 'jane', name: 'jane', avatar: '', provider: 'github' });
});

test('sessions expire after 7 days', async () => {
  const now = Date.UTC(2026, 0, 1);
  const token = await sealSession(user, SECRET, now);
  assert.deepEqual(await openSession(token, SECRET, now + SESSION_TTL * 1000 - 1000), user);
  assert.equal(await openSession(token, SECRET, now + SESSION_TTL * 1000 + 1000), null);
});

test('a short SESSION_SECRET is refused', async () => {
  await assert.rejects(sealSession(user, 'short'), /at least 32/);
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'short';
  try {
    assert.throws(() => sessionSecret(), /at least 32/);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test('provider and version round trip; old cookies without provider open as github', async () => {
  const pw = { login: 'jane', name: 'Jane', avatar: '', provider: 'password' as const, version: 3 };
  assert.deepEqual(await openSession(await sealSession(pw, SECRET), SECRET), pw);
  const old = await sealSession({ login: 'jane', name: 'Jane', avatar: '' } as never, SECRET);
  assert.deepEqual(await openSession(old, SECRET), { login: 'jane', name: 'Jane', avatar: '', provider: 'github' });
  const noVersion = await sealSession({ login: 'jane', name: 'J', avatar: '', provider: 'password' } as never, SECRET);
  assert.equal(await openSession(noVersion, SECRET), null, 'a password session must carry its version');
});
