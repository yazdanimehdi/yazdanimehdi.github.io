import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzip } from './test-unzip';
import { zip } from './vault-zip';

const files = [
  { path: 'vault/notes/Résumé.md', text: 'Café — ü\n'.repeat(50), date: new Date('2026-10-22T09:41:30Z') },
  { path: 'vault/papers/A.md', text: '', date: new Date('2024-02-29T23:59:58Z') },
  { path: 'vault/chats/B.md', text: 'plain', date: new Date('2026-01-01T00:00:00Z') },
  { path: 'vault/notes/Ré 🤖 漢.md', text: '漢字 🤖', date: new Date('2026-01-01T00:00:00Z') },
];

test('zip writes entries an unzip reads', () => {
  const read = unzip(zip(files));
  assert.deepEqual(
    read.map((f) => ({ path: f.path, text: f.text, date: f.date })),
    files,
  );
  assert.ok(
    read.every((f) => f.flags & 0x800),
    'names marked UTF-8',
  );
  assert.deepEqual(unzip(zip([])), []);
});

const hasUnzip = (() => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('the unzip tool extracts every entry, non-ASCII names too', { skip: !hasUnzip && 'no unzip on PATH' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vault-zip-'));
  try {
    const file = path.join(dir, 'vault.zip');
    writeFileSync(file, zip(files));
    assert.match(execFileSync('unzip', ['-t', file], { encoding: 'utf8' }), /No errors detected/);
    execFileSync('unzip', ['-q', file, '-d', path.join(dir, 'out')]);
    for (const f of files) assert.deepEqual(readFileSync(path.join(dir, 'out', f.path)), Buffer.from(f.text), f.path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
