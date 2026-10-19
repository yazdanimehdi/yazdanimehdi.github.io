import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canPublish, isAdminUser, loadAdminSettings } from './settings';

function fixture(site: string, cms: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-settings-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/site.yml'), site);
  fs.writeFileSync(path.join(root, 'config/cms.yml'), cms);
  return root;
}

test('loadAdminSettings reads site.yml and cms.yml', () => {
  const root = fixture(
    "siteMode: personal\nauthor: 'Dr. A'\nlabName: Lab\nadminPath: '/manage/'\nadminUsers: [alice]\npublishers: ['@bob']\n",
    "media_folder: 'src/assets/images'\npublic_folder: '/src/assets/images'\n",
  );
  assert.deepEqual(loadAdminSettings(root), {
    adminPath: 'manage',
    adminUsers: ['alice'],
    publishers: ['@bob'],
    mediaFolder: 'src/assets/images',
    publicFolder: '/src/assets/images',
    siteName: 'Dr. A',
  });
});

test('loadAdminSettings defaults: admin path, empty users, lab name in lab mode', () => {
  const s = loadAdminSettings(
    fixture('siteMode: lab\nauthor: A\nlabName: The Lab\n', 'media_folder: public/uploads\n'),
  );
  assert.equal(s.adminPath, 'admin');
  assert.deepEqual(s.adminUsers, []);
  assert.deepEqual(s.publishers, []);
  assert.equal(s.siteName, 'The Lab');
  assert.equal(s.publicFolder, '/public/uploads');
});

test('loadAdminSettings refuses a media_folder outside the repo', () => {
  for (const folder of ["''", "'/'", "'.'", "'../outside'", "'src/../../x'", "'src/..'"]) {
    assert.throws(
      () => loadAdminSettings(fixture('author: A\n', `media_folder: ${folder}\n`)),
      { message: 'config/cms.yml media_folder must be a relative folder inside the repo' },
      folder,
    );
  }
});

test('isAdminUser: usernames or profile URLs, case-insensitive', () => {
  const users = ['JaneSmith', 'https://github.com/alex-chen/', '@maria'];
  assert.ok(isAdminUser('janesmith', users));
  assert.ok(isAdminUser('Alex-Chen', users));
  assert.ok(isAdminUser('maria', users));
  assert.ok(!isAdminUser('jane', users));
  assert.ok(!isAdminUser('', users));
  assert.ok(!isAdminUser('github', ['https://github.com/org/repo']));
});

test('canPublish: unset means every admin; GitHub logins and password: accounts never stand in for each other', () => {
  const github = (login: string) => ({ login, provider: 'github' as const });
  const password = (login: string) => ({ login, provider: 'password' as const });
  assert.ok(canPublish(github('anyone'), { publishers: [] }));
  assert.ok(canPublish(password('anyone'), { publishers: [] }));

  const publishers = ['https://github.com/JaneSmith', 'password:Priya'];
  assert.ok(canPublish(github('janesmith'), { publishers }));
  assert.ok(canPublish(password('priya'), { publishers }));
  assert.ok(!canPublish(github('alex'), { publishers }));
  assert.ok(!canPublish(password('janesmith'), { publishers }), 'a password account named like a GitHub publisher');
  assert.ok(!canPublish(github('priya'), { publishers }), 'a GitHub login named like a password publisher');
  assert.ok(!canPublish(github('password:priya'), { publishers }));
});
