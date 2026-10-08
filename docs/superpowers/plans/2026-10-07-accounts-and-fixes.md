# Password accounts, local Neon dev, sub-project 4 follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Username/password admin accounts stored in Postgres (with a Users screen), a safe `pnpm dev:postgres` against a Neon `dev` branch, and every open follow-up from sub-project 4.

**Architecture:** Accounts live in two new tables (`admin_users`, `login_attempts`) behind one module, `src/lib/admin/accounts.ts`, which every route and script uses. The existing sealed session cookie gains `provider` and `version`. One function, `isAllowed`, is the middleware's single gate for both GitHub and password sessions. Local dev goes through a pure `devEnv()` that maps `DEV_DATABASE_URL` → `DATABASE_URL`, so the pulled production URL is never used.

**Tech Stack:** Astro 5, Vue 3 admin, TypeScript, Node `crypto.scrypt`, `node:test` via `tsx --test`, PGlite for database tests, postgres.js.

**Spec:** `docs/superpowers/specs/2026-10-07-accounts-and-fixes-design.md` (read it alongside this plan).

## Global Constraints

- Password sign-in, the Users screen and account routes exist only in Postgres mode; in git mode those routes answer 404 and the nav item is hidden. Git-mode GitHub sign-in is unchanged.
- Usernames: lowercased and trimmed on input, then must match `^[a-z0-9._-]{1,40}$`.
- Passwords: 12–200 characters. Hash: Node `crypto.scrypt`, 16-byte random salt, N=16384, r=8, p=1, 64-byte key, stored as `scrypt$16384$8$1$<salt b64url>$<key b64url>`; compare with `timingSafeEqual`. Unknown usernames verify against a dummy hash.
- Throttle: ≥ 10 failed attempts for a username within 15 minutes → 429 "Too many attempts; try again in 15 minutes" without checking the password. Each failure inserts a row; success deletes that username's rows; rows older than 1 day are deleted on each attempt.
- Messages (exact): 401 "Wrong username or password"; 503 "Password sign-in needs the database migration: run `pnpm db:migrate`"; 409 "You can't delete your own account"; 409 "You can't delete the last account"; 409 "That username is taken"; 400 "Passwords must be 12–200 characters"; 400 "Usernames are 1–40 lowercase letters, digits, dots, dashes or underscores".
- Sessions: same cookie `scholaros_session`, same options and 7-day lifetime. A sealed payload without `provider` opens as `provider: 'github'`.
- Local dev: `pnpm dev:postgres` never uses a `DATABASE_URL` from `.env.local` or the shell; `DATABASE_URL` is always `DEV_DATABASE_URL`.
- Tests: `node:test`, `pnpm test` (`tsx --test "src/**/*.test.ts"`), cwd = repo root. Database tests use `pgliteSql()` + `migrate()`.
- Match the surrounding code: short doc comments on exported functions, `// ponytail:` on deliberate ceilings, no abstractions beyond what a task names.

## Review Focus

1. **Username spelling**: "Jane " and "JANE" must reach the same account (sign-in, create, delete). Pinned in Task 1.
2. **Database unreachable during the middleware check** of a password session must answer 503, not 401: a 401 makes the admin reload into the login page in a loop during an outage. Pinned in Task 2.
3. **Cookies issued before this deploy** (no `provider`) must keep working for GitHub admins. Pinned in Task 2.
4. **Provider separation**: a password account named like a GitHub admin in `adminUsers` (or the reverse) must not gain access through the other provider's rule. Pinned in Task 2.
5. **Reused PDF name**: if a regenerated PDF has the same content hash as the stored one, the cleanup after a failed `cv.json` save must not delete the PDF the site links to. Pinned in Task 6.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `migrations/002_admin_users.sql` | 1 | tables |
| `src/lib/admin/passwords.ts` (+ test) | 1 | hash / verify / policy |
| `src/lib/admin/accounts.ts` (+ test) | 1 | account CRUD, sign-in check + throttle, session version |
| `src/lib/admin/session.ts` (+ test), `src/lib/admin/access.ts`, `src/middleware.ts` (+ test), `auth/callback.ts` | 2 | provider/version sessions, single gate |
| `src/admin/routes/api/auth/password.ts`, `src/admin/Login.vue`, `src/admin/routes/[...path].astro` | 3 | sign-in |
| `src/admin/routes/api/users.ts`, `users/[username].ts`, `account/password.ts`, `src/admin/Users.vue`, `AdminShell.vue`, `types.ts` | 4 | account management |
| `src/lib/dev-env.ts` (+ test), `scripts/dev-postgres.ts`, `scripts/admin-create-user.ts`, `package.json` | 5 | local dev + first account |
| `src/lib/cv-pdf/*`, `src/lib/admin/http.ts`, `cv/pdf.ts`, `Cv.vue`, `src/admin/api.test.ts` | 6 | CV PDF follow-ups |
| `src/lib/admin/jobs.ts`, `backup.ts`, `jobs.test.ts`, `config/feeds.yml` | 7 | jobs follow-ups, demo feeds |
| `src/lib/admin/medium.ts`, `posts/[slug]/medium.ts`, `src/lib/utils.ts`, `PostEditor.vue` (+ tests) | 8 | Medium follow-ups |
| `sync-template.yml`, `README.md`, `.env.example` | 9 | CI, docs, verification |

---

### Task 1: Password hashing and account storage

**Files:**
- Create: `migrations/002_admin_users.sql`, `src/lib/admin/passwords.ts`, `src/lib/admin/passwords.test.ts`, `src/lib/admin/accounts.ts`, `src/lib/admin/accounts.test.ts`, `src/lib/admin/access.ts` (only `sessionVersion` for now; Task 2 adds `isAllowed`)

**Interfaces:**
- Produces (`passwords.ts`): `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, stored: string): Promise<boolean>`, `assertPasswordPolicy(password: unknown): string` (throws `HttpError(400)`).
- Produces (`accounts.ts`):
  - `interface Account { username: string; name: string; created_at: string }`
  - `class MigrationMissingError extends Error`, `MIGRATION_MESSAGE`
  - `normalizeUsername(raw: unknown): string` (throws `HttpError(400)`)
  - `listAccounts(sql): Promise<Account[]>`
  - `createAccount(sql, username: unknown, name: unknown, password: unknown): Promise<Account>`
  - `resetPassword(sql, username: string, password: unknown): Promise<void>` (bumps `session_version`; 404 when missing)
  - `deleteAccount(sql, username: string, actor: { provider: string; login: string }): Promise<void>`
  - `signIn(sql, username: unknown, password: unknown, now?: Date): Promise<{ ok: true; account: { username: string; name: string; version: number } } | { ok: false; reason: 'wrong' | 'throttled' }>`
  - `sessionVersion(sql, username: string): Promise<number | null>` — in **`src/lib/admin/access.ts`**, not `accounts.ts`: the middleware imports it, and `accounts.ts` imports `http.ts` (which pulls in pdfmake); `access.ts` must import only `../db`-level modules. Null: no account or table missing.
  - `changeOwnPassword(sql, username: string, current: unknown, next: unknown): Promise<number>` (returns the new version; `HttpError(400, 'Your current password is wrong')`)
  - All `accounts.ts` functions throw `MigrationMissingError` when the tables don't exist (Postgres error code `42P01`); `sessionVersion` returns null instead.

- [ ] **Step 1: Migration**

`migrations/002_admin_users.sql`:

```sql
-- Password accounts for the admin (Postgres mode). Usernames are stored lowercase.
create table if not exists admin_users (
  username text primary key,
  name text not null,
  password_hash text not null,
  session_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Failed sign-ins, for throttling (also for usernames that don't exist).
create table if not exists login_attempts (
  username text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_username_at_idx on login_attempts (username, at desc);
```

- [ ] **Step 2: Write the failing password tests**

`src/lib/admin/passwords.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm exec tsx --test src/lib/admin/passwords.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `passwords.ts`**

```ts
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { HttpError } from './http';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { ...opts, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))),
  );
}

/** `scrypt$N$r$p$<salt>$<key>` (base64url): the parameters travel with the hash, so they can change later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Constant-time check; any malformed stored value is simply "no". */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0) || params.N < 1024) return false;
  const expected = Buffer.from(key, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  try {
    return timingSafeEqual(await derive(password, Buffer.from(salt, 'base64url'), params), expected);
  } catch {
    return false;
  }
}

export function assertPasswordPolicy(password: unknown): string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new HttpError(400, 'Passwords must be 12–200 characters');
  }
  return password;
}
```

Run: `pnpm exec tsx --test src/lib/admin/passwords.test.ts` → PASS.

- [ ] **Step 5: Write the failing account tests**

`src/lib/admin/accounts.test.ts`:

```ts
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import type { Sql } from '../db';
import {
  MigrationMissingError,
  changeOwnPassword,
  createAccount,
  deleteAccount,
  listAccounts,
  normalizeUsername,
  resetPassword,
  signIn,
} from './accounts';
import { sessionVersion } from './access';

let sql: Sql;
const PW = 'a long enough password';
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
});

test('usernames: trimmed and lowercased; invalid ones refused', () => {
  assert.equal(normalizeUsername('  Jane.Smith '), 'jane.smith');
  for (const bad of ['', 'has space', 'x'.repeat(41), 'semi;colon', 7]) {
    assert.throws(() => normalizeUsername(bad), /Usernames are 1–40/);
  }
});

test('create → list; duplicate (any case) is 409; sign-in works with any spelling of the username', async () => {
  const created = await createAccount(sql, 'Jane', 'Jane Smith', PW);
  assert.equal(created.username, 'jane');
  await assert.rejects(createAccount(sql, ' JANE ', 'Other', PW), /That username is taken/);
  assert.deepEqual(
    (await listAccounts(sql)).map((a) => [a.username, a.name]),
    [['jane', 'Jane Smith']],
  );
  const ok = await signIn(sql, ' JANE ', PW);
  assert.deepEqual(ok, { ok: true, account: { username: 'jane', name: 'Jane Smith', version: 1 } });
  assert.deepEqual(await signIn(sql, 'jane', 'wrong password 1'), { ok: false, reason: 'wrong' });
  assert.deepEqual(await signIn(sql, 'nobody', PW), { ok: false, reason: 'wrong' });
  assert.deepEqual(await signIn(sql, 'bad name!', PW), { ok: false, reason: 'wrong' });
});

test('throttle: the 11th try within 15 minutes is refused even with the right password; later it works', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  const t0 = new Date('2026-10-07T12:00:00Z');
  for (let i = 0; i < 10; i++) assert.equal((await signIn(sql, 'jane', 'wrong password 1', t0)).ok, false);
  assert.deepEqual(await signIn(sql, 'jane', PW, t0), { ok: false, reason: 'throttled' });
  const later = new Date(t0.getTime() + 16 * 60 * 1000);
  assert.equal((await signIn(sql, 'jane', PW, later)).ok, true);
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from login_attempts where username = 'jane'`;
  assert.equal(n, 0, 'success clears the attempts');
});

test('reset bumps the session version; change-own checks the current password', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  assert.equal(await sessionVersion(sql, 'jane'), 1);
  await resetPassword(sql, 'jane', 'a brand new password');
  assert.equal(await sessionVersion(sql, 'jane'), 2);
  assert.equal((await signIn(sql, 'jane', PW)).ok, false);
  await assert.rejects(changeOwnPassword(sql, 'jane', PW, 'another new password'), /Your current password is wrong/);
  assert.equal(await changeOwnPassword(sql, 'jane', 'a brand new password', 'another new password'), 3);
  assert.equal((await signIn(sql, 'jane', 'another new password')).ok, true);
  await assert.rejects(resetPassword(sql, 'nobody', PW), /Not found/);
  assert.equal(await sessionVersion(sql, 'nobody'), null);
});

test('delete: not yourself, not the last account; deleted accounts have no session version', async () => {
  await createAccount(sql, 'jane', 'Jane', PW);
  await assert.rejects(deleteAccount(sql, 'jane', { provider: 'github', login: 'someone' }), /last account/);
  await createAccount(sql, 'bo', 'Bo', PW);
  await assert.rejects(deleteAccount(sql, 'jane', { provider: 'password', login: 'jane' }), /your own account/);
  await deleteAccount(sql, 'BO', { provider: 'password', login: 'jane' });
  assert.equal(await sessionVersion(sql, 'bo'), null);
});

test('before the migration: MigrationMissingError; sessionVersion answers null', async () => {
  const bare = pgliteSql();
  await assert.rejects(signIn(bare, 'jane', PW), MigrationMissingError);
  assert.equal(await sessionVersion(bare, 'jane'), null);
});
```

Run: `pnpm exec tsx --test src/lib/admin/accounts.test.ts` → FAIL (module not found).

- [ ] **Step 6: Implement `accounts.ts`**

```ts
import type { Sql } from '../db';
import { HttpError } from './http';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './passwords';

export interface Account {
  username: string;
  name: string;
  created_at: string;
}

export const MIGRATION_MESSAGE = 'Password sign-in needs the database migration: run `pnpm db:migrate`';
export class MigrationMissingError extends Error {
  constructor() {
    super(MIGRATION_MESSAGE);
  }
}

const USERNAME = /^[a-z0-9._-]{1,40}$/;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

/** Postgres "undefined_table": migration 002 hasn't run on this database. */
async function tables<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if ((e as { code?: unknown }).code === '42P01') throw new MigrationMissingError();
    throw e;
  }
}

export function normalizeUsername(raw: unknown): string {
  const username = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!USERNAME.test(username)) {
    throw new HttpError(400, 'Usernames are 1–40 lowercase letters, digits, dots, dashes or underscores');
  }
  return username;
}

function displayName(raw: unknown, username: string): string {
  return (typeof raw === 'string' ? raw.trim().slice(0, 100) : '') || username;
}

export function listAccounts(sql: Sql): Promise<Account[]> {
  return tables(async () =>
    (
      await sql<{ username: string; name: string; created_at: Date }>`
        select username, name, created_at from admin_users order by username`
    ).map((r) => ({ username: r.username, name: r.name, created_at: new Date(r.created_at).toISOString() })),
  );
}

export async function createAccount(sql: Sql, username: unknown, name: unknown, password: unknown): Promise<Account> {
  const user = normalizeUsername(username);
  const hash = await hashPassword(assertPasswordPolicy(password));
  const rows = await tables(
    () => sql<{ created_at: Date }>`
      insert into admin_users (username, name, password_hash) values (${user}, ${displayName(name, user)}, ${hash})
      on conflict (username) do nothing returning created_at`,
  );
  if (rows.length === 0) throw new HttpError(409, 'That username is taken');
  return { username: user, name: displayName(name, user), created_at: new Date(rows[0].created_at).toISOString() };
}

/** New password + a new session version: every existing session of the account ends. */
export async function resetPassword(sql: Sql, username: string, password: unknown): Promise<void> {
  const hash = await hashPassword(assertPasswordPolicy(password));
  const rows = await tables(
    () => sql`
      update admin_users set password_hash = ${hash}, session_version = session_version + 1, updated_at = now()
      where username = ${normalizeUsername(username)} returning username`,
  );
  if (rows.length === 0) throw new HttpError(404, 'Not found');
}

export async function deleteAccount(
  sql: Sql,
  username: string,
  actor: { provider: string; login: string },
): Promise<void> {
  const user = normalizeUsername(username);
  if (actor.provider === 'password' && actor.login === user) throw new HttpError(409, "You can't delete your own account");
  await tables(() =>
    sql.begin(async (tx) => {
      const [{ n }] = await tx<{ n: number }>`select count(*)::int as n from admin_users`;
      const rows = await tx`select username from admin_users where username = ${user} for update`;
      if (rows.length === 0) throw new HttpError(404, 'Not found');
      if (n <= 1) throw new HttpError(409, "You can't delete the last account");
      await tx`delete from admin_users where username = ${user}`;
    }),
  );
}

let dummy: Promise<string> | null = null;
/** Verifying an unknown username against this costs what a real check costs, so timing doesn't reveal usernames. */
const dummyHash = () => (dummy ??= hashPassword('unused-dummy-password'));

export async function signIn(
  sql: Sql,
  username: unknown,
  password: unknown,
  now = new Date(),
): Promise<{ ok: true; account: { username: string; name: string; version: number } } | { ok: false; reason: 'wrong' | 'throttled' }> {
  const typed = typeof username === 'string' ? username.trim().toLowerCase().slice(0, 100) : '';
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  return tables(async () => {
    await sql`delete from login_attempts where at < ${new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()}::timestamptz`;
    const [{ n }] = await sql<{ n: number }>`
      select count(*)::int as n from login_attempts where username = ${typed} and at > ${since}::timestamptz`;
    if (n >= MAX_FAILURES) return { ok: false, reason: 'throttled' } as const;
    const [row] = USERNAME.test(typed)
      ? await sql<{ name: string; password_hash: string; session_version: number }>`
          select name, password_hash, session_version from admin_users where username = ${typed}`
      : [];
    const good =
      typeof password === 'string' && (await verifyPassword(password, row?.password_hash ?? (await dummyHash())));
    if (!row || !good) {
      await sql`insert into login_attempts (username, at) values (${typed}, ${now.toISOString()}::timestamptz)`;
      return { ok: false, reason: 'wrong' } as const;
    }
    await sql`delete from login_attempts where username = ${typed}`;
    return { ok: true, account: { username: typed, name: row.name, version: row.session_version } } as const;
  });
}

/** Checks the current password, stores the new one, bumps the version (other devices sign out); returns it. */
export async function changeOwnPassword(sql: Sql, username: string, current: unknown, next: unknown): Promise<number> {
  const user = normalizeUsername(username);
  const nextPassword = assertPasswordPolicy(next);
  const [row] = await tables(
    () => sql<{ password_hash: string }>`select password_hash from admin_users where username = ${user}`,
  );
  if (!row || typeof current !== 'string' || !(await verifyPassword(current, row.password_hash))) {
    throw new HttpError(400, 'Your current password is wrong');
  }
  const hash = await hashPassword(nextPassword);
  const [updated] = await sql<{ v: number }>`
    update admin_users set password_hash = ${hash}, session_version = session_version + 1, updated_at = now()
    where username = ${user} returning session_version as v`;
  return updated.v;
}
```

`src/lib/admin/access.ts` (kept free of `http.ts`/`accounts.ts` imports — the middleware loads it on every request):

```ts
import type { Sql } from '../db';

/** The account's current session version; null when it doesn't exist or the tables don't (yet). */
export async function sessionVersion(sql: Sql, username: string): Promise<number | null> {
  try {
    const [row] = await sql<{ v: number }>`select session_version as v from admin_users where username = ${username}`;
    return row ? row.v : null;
  } catch (e) {
    if ((e as { code?: unknown }).code === '42P01') return null;
    throw e;
  }
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm exec tsx --test src/lib/admin/passwords.test.ts src/lib/admin/accounts.test.ts` → PASS. If PGlite reports the missing-table error with a different `code`, print the error in the last test and adapt the `42P01` check to what it actually reports (Postgres and PGlite both use SQLSTATE `42P01`). Then `pnpm test` once.

- [ ] **Step 8: Commit**

```bash
git add migrations/002_admin_users.sql src/lib/admin/passwords.ts src/lib/admin/passwords.test.ts src/lib/admin/accounts.ts src/lib/admin/accounts.test.ts src/lib/admin/access.ts
git commit -m "feat(accounts): password accounts with scrypt hashes and sign-in throttling"
```

---

### Task 2: Sessions carry provider and version; one gate in the middleware

**Files:**
- Create: `src/lib/admin/access.test.ts`
- Modify: `src/lib/admin/access.ts` (add `isAllowed` next to `sessionVersion`), `src/lib/admin/session.ts`, `src/lib/admin/session.test.ts`, `src/middleware.ts`, `src/middleware.test.ts`, `src/admin/routes/api/auth/callback.ts`

**Interfaces:**
- Consumes: `sessionVersion(sql, username)` (Task 1, same file); `isAdminUser`, `adminSettings` (settings.ts); `getMode`; `getSql`, `isUnreachable` (db.ts).
- Produces:
  - `SessionUser = { login: string; name: string; avatar: string; provider: 'github' | 'password'; version?: number }`. `openSession` always returns `provider`, and `version` only for password sessions.
  - `isAllowed(user: SessionUser, adminUsers: string[]): Promise<boolean>` (access.ts). It throws when the database is unreachable; the middleware maps that to 503.

- [ ] **Step 1: Write the failing tests**

`src/lib/admin/session.test.ts`:
- In `user`, add `provider: 'github' as const`. The existing round-trip and expiry `deepEqual`s then compare against that.
- In "a payload without name or avatar", the expected values gain `provider: 'github'`.
- Append:

```ts
test('provider and version round trip; old cookies without provider open as github', async () => {
  const pw = { login: 'jane', name: 'Jane', avatar: '', provider: 'password' as const, version: 3 };
  assert.deepEqual(await openSession(await sealSession(pw, SECRET), SECRET), pw);
  const old = await sealSession({ login: 'jane', name: 'Jane', avatar: '' } as never, SECRET);
  assert.deepEqual(await openSession(old, SECRET), { login: 'jane', name: 'Jane', avatar: '', provider: 'github' });
  const noVersion = await sealSession({ login: 'jane', name: 'J', avatar: '', provider: 'password' } as never, SECRET);
  assert.equal(await openSession(noVersion, SECRET), null, 'a password session must carry its version');
});
```

`src/lib/admin/access.test.ts`:

```ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { createAccount, resetPassword } from './accounts';
import { isAllowed } from './access';

let sql: Sql;
const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL };
before(async () => {
  sql = pgliteSql();
  await migrate(sql);
  await createAccount(sql, 'jane', 'Jane', 'a long enough password');
  setSqlForTests(sql);
  Object.assign(process.env, { VERCEL: '1', DATABASE_URL: 'postgres://test' });
});
after(() => {
  setSqlForTests(null);
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

const pw = (login: string, version: number) => ({ login, name: login, avatar: '', provider: 'password' as const, version });
const gh = (login: string) => ({ login, name: login, avatar: '', provider: 'github' as const });

test('password sessions: allowed while the account exists and the version matches', async () => {
  assert.equal(await isAllowed(pw('jane', 1), []), true);
  assert.equal(await isAllowed(pw('jane', 0), []), false);
  assert.equal(await isAllowed(pw('ghost', 1), []), false);
  await resetPassword(sql, 'jane', 'a different long password');
  assert.equal(await isAllowed(pw('jane', 1), []), false, 'a reset ends older sessions');
  assert.equal(await isAllowed(pw('jane', 2), []), true);
});

test('providers never vouch for each other', async () => {
  assert.equal(await isAllowed(gh('jane'), []), false, 'a password account name is not a GitHub admin');
  assert.equal(await isAllowed(pw('janesmith', 1), ['janesmith']), false, 'adminUsers does not admit a password session');
  assert.equal(await isAllowed(gh('janesmith'), ['janesmith']), true);
});

test('git mode: password sessions are never allowed', async () => {
  delete process.env.DATABASE_URL;
  try {
    assert.equal(await isAllowed(pw('jane', 2), []), false);
  } finally {
    process.env.DATABASE_URL = 'postgres://test';
  }
});

test('an unreachable database throws (the middleware answers 503)', async () => {
  setSqlForTests((async () => {
    throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
  }) as unknown as Sql);
  try {
    await assert.rejects(isAllowed(pw('jane', 2), []), /down/);
  } finally {
    setSqlForTests(sql);
  }
});
```

`src/middleware.test.ts`:
- Change `user` to include `provider: 'github' as const`, since the `deepEqual` on `ctx.locals.user` now includes it.
- Append:

```ts
test('a password session whose database check fails answers 503, not 401', async () => {
  const { setSqlForTests } = await import('./lib/db');
  const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL };
  Object.assign(process.env, { VERCEL: '1', DATABASE_URL: 'postgres://test' });
  setSqlForTests((async () => {
    throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
  }) as never);
  try {
    const cookie = await sealSession(
      { login: 'jane', name: 'Jane', avatar: '', provider: 'password', version: 1 },
      process.env.SESSION_SECRET!,
    );
    const api = await run(context('/api/admin/me', { cookie }));
    assert.equal(api.status, 503);
    const page = await run(context(`${admin}/cv`, { cookie }));
    assert.equal(page.status, 503);
  } finally {
    setSqlForTests(null);
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
```

Run: `pnpm exec tsx --test src/lib/admin/session.test.ts src/lib/admin/access.test.ts src/middleware.test.ts` → FAIL.

- [ ] **Step 2: Sessions**

`src/lib/admin/session.ts`:
- `SessionUser` becomes:
  ```ts
  export interface SessionUser {
    login: string;
    name: string;
    avatar: string;
    /** How the session was opened; cookies from before password sign-in existed have none and mean GitHub. */
    provider: 'github' | 'password';
    /** Password sessions: the account's session_version at sign-in (a reset or password change ends the session). */
    version?: number;
  }
  ```
- `sealSession` writes `provider: user.provider ?? 'github'` and, when `provider === 'password'`, `version: user.version` into the payload.
- `openSession` parses `provider`/`version`:
  ```ts
  const provider = p.provider === 'password' ? 'password' : 'github';
  if (provider === 'password' && (typeof p.version !== 'number' || !Number.isInteger(p.version))) return null;
  return {
    login: p.login,
    name: typeof p.name === 'string' ? p.name : p.login,
    avatar: typeof p.avatar === 'string' ? p.avatar : '',
    provider,
    ...(provider === 'password' ? { version: p.version as number } : {}),
  };
  ```
  Widen the parsed type with `provider: unknown; version: unknown`.

`src/admin/routes/api/auth/callback.ts`: add `provider: 'github'` to the `sealSession` user.
`src/admin/routes/api/auth/dev.ts`: add `provider: 'github'` to its `sealSession` user.

- [ ] **Step 3: The gate**

Add to the top of `src/lib/admin/access.ts` and below `sessionVersion` (imports must stay light: no `http.ts`, no `accounts.ts`):

```ts
import { getSql, type Sql } from '../db';
import { getMode } from '../mode';
import type { SessionUser } from './session';
import { isAdminUser } from './settings';

/**
 * Whether a session may use the admin, checked on every admin request: GitHub sessions by `adminUsers` (removing a
 * login ends the session), password sessions by their account (deleting it, or a reset/change, ends the session).
 * An unreachable database throws: the caller answers 503 instead of signing the user out.
 */
export async function isAllowed(user: SessionUser, adminUsers: string[]): Promise<boolean> {
  if (user.provider !== 'password') return isAdminUser(user.login, adminUsers);
  if (getMode() !== 'postgres') return false;
  const version = await sessionVersion(getSql(), user.login);
  return version !== null && version === user.version;
}
```

`src/middleware.ts`:
- Import `isAllowed` from `./lib/admin/access` and `isUnreachable` from `./lib/db`.
- Replace the session branch (`const token = …` through the `else` that answers 401/redirect) with:

```ts
    const token = ctx.cookies.get(SESSION_COOKIE)?.value;
    const user = token ? await openSession(token, sessionSecret()) : null;
    let allowed = false;
    try {
      allowed = !!user && (await isAllowed(user, adminUsers));
    } catch (e) {
      if (!isUnreachable(e)) throw e;
      // eslint-disable-next-line no-console
      console.error('[middleware] database unreachable while checking a password session', e);
      res = api ? jsonError(503, 'The database is unreachable. Try again in a moment.') : unavailable();
    }
    if (res! === undefined) {
      if (allowed) {
        ctx.locals.user = user!;
        res = await next();
      } else {
        res = api ? jsonError(401, 'Not signed in') : ctx.redirect(`/${adminPath}/login`);
      }
    }
```

Write it so `res` is definitely assigned without non-null tricks, e.g. a `let res: Response | undefined` for that branch. Drop `isAdminUser` from the middleware's imports if it's now unused. The existing comment "Removing someone from adminUsers ends their session at the next request." moves into `access.ts` (already there).

- [ ] **Step 4: Run tests**

Run: `pnpm exec tsx --test src/lib/admin/session.test.ts src/lib/admin/access.test.ts src/middleware.test.ts src/lib/admin/routes.test.ts src/lib/admin/auth.test.ts` → PASS. Then `pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/session.ts src/lib/admin/session.test.ts src/lib/admin/access.ts src/lib/admin/access.test.ts src/middleware.ts src/middleware.test.ts src/admin/routes/api/auth/callback.ts src/admin/routes/api/auth/dev.ts
git commit -m "feat(accounts): sessions record provider and version; one admin gate for GitHub and password sessions"
```

---

### Task 3: Sign-in route and login page

**Files:**
- Create: `src/admin/routes/api/auth/password.ts`, `src/admin/Login.vue`, `src/lib/admin/password-route.test.ts`
- Modify: `src/admin/routes/[...path].astro`

**Interfaces:**
- Consumes: `signIn`, `MigrationMissingError`, `MIGRATION_MESSAGE` (Task 1); `sealSession`, `SESSION_COOKIE`, `SESSION_COOKIE_OPTIONS`, `sessionSecret` (Task 2); `getSql`, `isUnreachable`; `json` (http.ts); `getMode`.
- Produces: `POST /api/admin/auth/password` `{ username, password }` → 200 `{ ok: true }` + cookie | 400 | 401 | 404 (git mode) | 429 | 503.

- [ ] **Step 1: Write the failing test**

`src/lib/admin/password-route.test.ts`:

```ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { createAccount } from './accounts';
import { SESSION_COOKIE, openSession } from './session';
import { POST as signIn } from '../../admin/routes/api/auth/password';

let sql: Sql;
const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL, SESSION_SECRET: process.env.SESSION_SECRET };
before(async () => {
  sql = pgliteSql();
  await migrate(sql);
  await createAccount(sql, 'jane', 'Jane Smith', 'a long enough password');
  setSqlForTests(sql);
  Object.assign(process.env, { VERCEL: '1', DATABASE_URL: 'postgres://test', SESSION_SECRET: 's'.repeat(32) });
});
after(() => {
  setSqlForTests(null);
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});

function call(body: unknown) {
  const set = new Map<string, string>();
  const res = signIn({
    request: new Request('https://site.test/api/admin/auth/password', { method: 'POST', body: JSON.stringify(body) }),
    cookies: { set: (name: string, value: string) => set.set(name, value) },
  } as never) as Promise<Response>;
  return res.then((r) => ({ res: r, cookie: set.get(SESSION_COOKIE) }));
}

test('right password: 200 and a password session for the account', async () => {
  const { res, cookie } = await call({ username: ' Jane ', password: 'a long enough password' });
  assert.equal(res.status, 200);
  assert.deepEqual(await openSession(cookie!, process.env.SESSION_SECRET!), {
    login: 'jane',
    name: 'Jane Smith',
    avatar: '',
    provider: 'password',
    version: 1,
  });
});

test('wrong password and unknown user: the same 401; bad body 400', async () => {
  for (const body of [{ username: 'jane', password: 'nope nope nope' }, { username: 'ghost', password: 'nope nope nope' }]) {
    const { res, cookie } = await call(body);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'Wrong username or password');
    assert.equal(cookie, undefined);
  }
  assert.equal((await call('just a string')).res.status, 400);
});

test('throttled: 429', async () => {
  for (let i = 0; i < 10; i++) await call({ username: 'throttle-me', password: 'nope nope nope' });
  const { res } = await call({ username: 'throttle-me', password: 'nope nope nope' });
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /Too many attempts; try again in 15 minutes/);
});

test('before the migration: 503 with the migration message', async () => {
  setSqlForTests(pgliteSql());
  try {
    const { res } = await call({ username: 'jane', password: 'a long enough password' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /run `pnpm db:migrate`/);
  } finally {
    setSqlForTests(sql);
  }
});

test('git mode: 404', async () => {
  delete process.env.DATABASE_URL;
  try {
    assert.equal((await call({ username: 'jane', password: 'a long enough password' })).res.status, 404);
  } finally {
    process.env.DATABASE_URL = 'postgres://test';
  }
});
```

Run: `pnpm exec tsx --test src/lib/admin/password-route.test.ts` → FAIL.

- [ ] **Step 2: Implement the route**

`src/admin/routes/api/auth/password.ts`:

```ts
import type { APIRoute } from 'astro';
import { MIGRATION_MESSAGE, MigrationMissingError, signIn } from '../../../../lib/admin/accounts';
import { json } from '../../../../lib/admin/http';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, sealSession, sessionSecret } from '../../../../lib/admin/session';
import { getSql, isUnreachable } from '../../../../lib/db';
import { getMode } from '../../../../lib/mode';

export const prerender = false;

/** Username + password sign-in (Postgres mode). Same cookie as GitHub sign-in; the middleware re-checks the account on every request. */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (getMode() !== 'postgres') return json({ error: 'Not found' }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'The request body must be JSON' }, 400);
  }
  const { username, password } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return json({ error: '`username` and `password` are required' }, 400);
  }
  try {
    const result = await signIn(getSql(), username, password);
    if (!result.ok) {
      return result.reason === 'throttled'
        ? json({ error: 'Too many attempts; try again in 15 minutes' }, 429)
        : json({ error: 'Wrong username or password' }, 401);
    }
    const { account } = result;
    cookies.set(
      SESSION_COOKIE,
      await sealSession(
        { login: account.username, name: account.name, avatar: '', provider: 'password', version: account.version },
        sessionSecret(),
      ),
      SESSION_COOKIE_OPTIONS,
    );
    return json({ ok: true });
  } catch (e) {
    if (e instanceof MigrationMissingError) return json({ error: MIGRATION_MESSAGE }, 503);
    if (isUnreachable(e)) return json({ error: 'The database is unreachable. Try again in a moment.' }, 503);
    throw e;
  }
};
```

Run the test → PASS.

- [ ] **Step 3: Login page**

`src/admin/Login.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ adminPath: string; siteName: string; password: boolean; github: boolean; error: string }>();
const username = ref('');
const password = ref('');
const message = ref(props.error);
const busy = ref(false);

/** Not the shared api(): it reloads the page on 401, which here just means "wrong password". */
async function submit() {
  busy.value = true;
  message.value = '';
  try {
    const res = await fetch('/api/admin/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    if (res.ok) {
      location.href = `/${props.adminPath}`;
      return;
    }
    message.value = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? res.statusText;
  } catch {
    message.value = 'Could not reach the site. Try again.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="adm-login">
    <h1>{{ siteName }}</h1>
    <p class="adm-muted">Site admin</p>
    <form v-if="password" class="adm-form" @submit.prevent="submit">
      <label class="adm-field">
        <span>Username</span>
        <input v-model="username" type="text" autocomplete="username" autocapitalize="none" required />
      </label>
      <label class="adm-field">
        <span>Password</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <button type="submit" class="adm-btn adm-btn-primary" :disabled="busy">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
    <a v-if="github" class="adm-btn" :class="{ 'adm-btn-primary': !password }" href="/api/admin/auth/login">
      Sign in with GitHub
    </a>
    <p v-if="message" class="adm-error" role="alert">{{ message }}</p>
  </main>
</template>
```

`src/admin/routes/[...path].astro`:
- Import `Login from '../Login.vue'`.
- In the frontmatter compute:
  ```ts
  const mode = getMode();
  const githubLogin = mode !== 'postgres' || !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  const loginError = error ? (Object.hasOwn(LOGIN_ERRORS, error) ? LOGIN_ERRORS[error] : LOGIN_ERRORS.expired) : '';
  ```
  Move `LOGIN_ERRORS` above that line, and use `mode` in `ctx`.
- Replace the `screen === 'login' && (<main class="adm-login">…</main>)` block with:
  ```astro
  {
    screen === 'login' && (
      <Login
        client:only="vue"
        adminPath={adminPath}
        siteName={siteName}
        password={mode === 'postgres'}
        github={githubLogin}
        error={loginError}
      />
    )
  }
  ```

- [ ] **Step 4: Verify**

Run: `pnpm test` → PASS. Run `pnpm lint` (no new errors). Run `rm -rf .vercel/output && VERCEL=1 SESSION_SECRET=ci-build-only-not-a-real-secret-0000 pnpm build`, then `rm -rf .vercel/output && VERCEL=1 DATABASE_URL=postgres://ci@localhost:1/ci SESSION_SECRET=ci-build-only-not-a-real-secret-0000 pnpm build`, then `pnpm build` (static last).

- [ ] **Step 5: Commit**

```bash
git add src/admin/routes/api/auth/password.ts src/admin/Login.vue "src/admin/routes/[...path].astro" src/lib/admin/password-route.test.ts
git commit -m "feat(accounts): username and password sign-in on the admin login page (Postgres mode)"
```

---

### Task 4: Users screen and changing your own password

**Files:**
- Create: `src/admin/routes/api/users.ts`, `src/admin/routes/api/users/[username].ts`, `src/admin/routes/api/account/password.ts`, `src/admin/Users.vue`, `src/lib/admin/users-routes.test.ts`
- Modify: `src/admin/routes/[...path].astro`, `src/admin/AdminShell.vue`, `src/admin/types.ts`

**Interfaces:**
- Consumes: Task 1 account functions; `route`, `json`, `readBody`, `postgresOnly`, `HttpError` (http.ts); `MigrationMissingError` → map to 503 with `MIGRATION_MESSAGE`; `adminSettings().adminUsers`, `adminLogin`; session helpers (Task 2).
- Produces:
  - `GET /api/admin/users` → `{ accounts: Account[], githubAdmins: string[] }`
  - `POST /api/admin/users` `{ username, name, password }` → 201 `Account`
  - `PUT /api/admin/users/[username]` `{ password }` → `{ ok: true }`
  - `DELETE /api/admin/users/[username]` → `{ ok: true }`
  - `POST /api/admin/account/password` `{ current, next }` → `{ ok: true }` and a re-sealed cookie
  - `AdminCtx.user` gains `provider?: 'github' | 'password'`

- [ ] **Step 1: Write the failing tests**

`src/lib/admin/users-routes.test.ts`:

```ts
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db-migrate';
import { pgliteSql } from '../pglite-sql';
import { setSqlForTests, type Sql } from '../db';
import { setStoreForTests } from './get-store';
import { MemoryStore } from './memory-store';
import { PostgresStore } from './postgres-store';
import { createAccount, signIn } from './accounts';
import { sessionVersion } from './access';
import { SESSION_COOKIE, openSession } from './session';
import { GET as list, POST as create } from '../../admin/routes/api/users';
import { DELETE as remove, PUT as reset } from '../../admin/routes/api/users/[username]';
import { POST as changeOwn } from '../../admin/routes/api/account/password';

let sql: Sql;
const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL, SESSION_SECRET: process.env.SESSION_SECRET };
const PW = 'a long enough password';
before(() => Object.assign(process.env, { VERCEL: '1', DATABASE_URL: 'postgres://test', SESSION_SECRET: 's'.repeat(32) }));
after(() => {
  setSqlForTests(null);
  setStoreForTests(null);
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
});
beforeEach(async () => {
  sql = pgliteSql();
  await migrate(sql);
  await createAccount(sql, 'jane', 'Jane', PW);
  setSqlForTests(sql);
  setStoreForTests((a) => new PostgresStore(sql, a, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }));
});

const me = { login: 'jane', name: 'Jane', avatar: '', provider: 'password' as const, version: 1 };
function call(
  handler: (ctx: never) => Response | Promise<Response>,
  opts: { method?: string; params?: Record<string, string>; body?: unknown; user?: unknown } = {},
) {
  const set = new Map<string, string>();
  const url = new URL('https://site.test/api/admin/x');
  const request = new Request(url, { method: opts.method ?? 'GET', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return Promise.resolve(
    handler({
      request,
      url,
      params: opts.params ?? {},
      locals: { user: opts.user ?? me },
      cookies: { set: (n: string, v: string) => set.set(n, v) },
    } as never),
  ).then((res) => ({ res, cookie: set.get(SESSION_COOKIE) }));
}

test('list, create (201, 409 on duplicate), reset bumps the version, delete', async () => {
  const listed = await (await call(list)).res.json();
  assert.deepEqual(listed.accounts.map((a: { username: string }) => a.username), ['jane']);
  assert.ok(Array.isArray(listed.githubAdmins));
  assert.equal((await call(create, { method: 'POST', body: { username: 'Bo', name: 'Bo Li', password: PW } })).res.status, 201);
  assert.equal((await call(create, { method: 'POST', body: { username: 'bo', name: 'X', password: PW } })).res.status, 409);
  assert.equal((await call(create, { method: 'POST', body: { username: 'cy', name: 'C', password: 'short' } })).res.status, 400);
  assert.equal((await call(reset, { method: 'PUT', params: { username: 'bo' }, body: { password: 'a new long password' } })).res.status, 200);
  assert.equal(await sessionVersion(sql, 'bo'), 2);
  assert.equal((await call(remove, { method: 'DELETE', params: { username: 'jane' } })).res.status, 409, 'not yourself');
  assert.equal((await call(remove, { method: 'DELETE', params: { username: 'bo' } })).res.status, 200);
  assert.equal(await sessionVersion(sql, 'bo'), null);
});

test('change own password: wrong current 400; success re-seals this session with the new version', async () => {
  assert.equal((await call(changeOwn, { method: 'POST', body: { current: 'wrong wrong wrong', next: 'another long password' } })).res.status, 400);
  const { res, cookie } = await call(changeOwn, { method: 'POST', body: { current: PW, next: 'another long password' } });
  assert.equal(res.status, 200);
  const session = await openSession(cookie!, process.env.SESSION_SECRET!);
  assert.equal(session?.version, 2);
  assert.equal((await signIn(sql, 'jane', 'another long password')).ok, true);
});

test('GitHub sessions cannot change "their" password; git mode answers 404', async () => {
  const gh = { login: 'jane', name: 'Jane', avatar: '', provider: 'github' as const };
  assert.equal((await call(changeOwn, { method: 'POST', body: { current: PW, next: 'x'.repeat(12) }, user: gh })).res.status, 404);
  setStoreForTests(() => new MemoryStore());
  assert.equal((await call(list)).res.status, 404);
});
```

Run: `pnpm exec tsx --test src/lib/admin/users-routes.test.ts` → FAIL.

- [ ] **Step 2: Routes**

A shared wrapper for the account routes goes in `src/lib/admin/accounts.ts`:

```ts
/** Account routes run in Postgres mode only; a missing migration answers 503 with the fix. */
export async function withAccounts<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof MigrationMissingError) throw new HttpError(503, MIGRATION_MESSAGE);
    throw e;
  }
}
```

`src/admin/routes/api/users.ts`:

```ts
import { createAccount, listAccounts, withAccounts } from '../../../lib/admin/accounts';
import { json, postgresOnly, readBody, route } from '../../../lib/admin/http';
import { adminLogin, adminSettings } from '../../../lib/admin/settings';
import { getSql } from '../../../lib/db';

export const prerender = false;

export const GET = route(async (_ctx, store) => {
  postgresOnly(store);
  return json({
    accounts: await withAccounts(() => listAccounts(getSql())),
    githubAdmins: adminSettings().adminUsers.map(adminLogin),
  });
});

export const POST = route(async (ctx, store) => {
  postgresOnly(store);
  const { username, name, password } = await readBody<{ username?: unknown; name?: unknown; password?: unknown }>(ctx);
  return json(await withAccounts(() => createAccount(getSql(), username, name, password)), 201);
});
```

`src/admin/routes/api/users/[username].ts`:

```ts
import { deleteAccount, resetPassword, withAccounts } from '../../../../lib/admin/accounts';
import { json, postgresOnly, readBody, route } from '../../../../lib/admin/http';
import { getSql } from '../../../../lib/db';

export const prerender = false;

/** Reset someone's password: their sessions end; they sign in with the new one. */
export const PUT = route(async (ctx, store) => {
  postgresOnly(store);
  const { password } = await readBody<{ password?: unknown }>(ctx);
  await withAccounts(() => resetPassword(getSql(), String(ctx.params.username), password));
  return json({ ok: true });
});

export const DELETE = route(async (ctx, store, user) => {
  postgresOnly(store);
  await withAccounts(() => deleteAccount(getSql(), String(ctx.params.username), user));
  return json({ ok: true });
});
```

`src/admin/routes/api/account/password.ts`:

```ts
import { changeOwnPassword, withAccounts } from '../../../../lib/admin/accounts';
import { HttpError, json, postgresOnly, readBody, route } from '../../../../lib/admin/http';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, sealSession, sessionSecret } from '../../../../lib/admin/session';
import { getSql } from '../../../../lib/db';

export const prerender = false;

/** Change your own password: other devices sign out, this one gets a fresh cookie with the new version. */
export const POST = route(async (ctx, store, user) => {
  postgresOnly(store);
  if (user.provider !== 'password') throw new HttpError(404, 'Only password accounts have a password here');
  const { current, next } = await readBody<{ current?: unknown; next?: unknown }>(ctx);
  const version = await withAccounts(() => changeOwnPassword(getSql(), user.login, current, next));
  ctx.cookies.set(SESSION_COOKIE, await sealSession({ ...user, version }, sessionSecret()), SESSION_COOKIE_OPTIONS);
  return json({ ok: true });
});
```

Run the test → PASS.

- [ ] **Step 3: Screen and navigation**

`src/admin/types.ts` `AdminCtx.user`: `{ login: string; name: string; avatar: string; provider?: 'github' | 'password' } | null`.

`src/admin/AdminShell.vue`: show a "Users" link (`users`) in the bottom group only when `ctx.mode === 'postgres'`. Make `BOTTOM` a computed:
```ts
const BOTTOM = computed(() => [
  ['pages', 'Pages'],
  ['media', 'Media'],
  ...(props.ctx.mode === 'postgres' ? [['users', 'Users'] as const] : []),
  ['settings', 'Settings'],
]);
```
Import `computed`; the template iterates `BOTTOM`. Vue unwraps it in the template, but check the existing `v-for` still compiles.

`src/admin/routes/[...path].astro`:
- Add `'users'` to `SCREENS`.
- After the content check: `if (screen === 'users' && mode !== 'postgres') return new Response('Not found', { status: 404 });`.
- Render: `{screen === 'users' && <Users client:only="vue" ctx={ctx} />}`.
- Import `Users from '../Users.vue'`.

`src/admin/Users.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, report, toast } from './api';
import type { AdminCtx } from './types';

interface Account {
  username: string;
  name: string;
  created_at: string;
}
const props = defineProps<{ ctx: AdminCtx }>();
const accounts = ref<Account[]>([]);
const githubAdmins = ref<string[]>([]);
const adding = ref({ username: '', name: '', password: '' });
const resetting = ref<{ username: string; password: string } | null>(null);
const confirmDelete = ref('');
const own = ref({ current: '', next: '', again: '' });
const isPassword = props.ctx.user?.provider === 'password';

async function load() {
  try {
    const data = await api<{ accounts: Account[]; githubAdmins: string[] }>('users');
    accounts.value = data.accounts;
    githubAdmins.value = data.githubAdmins;
  } catch (e) {
    report(e);
  }
}

async function add() {
  try {
    await api('users', { body: adding.value });
    toast(`Added ${adding.value.username}`);
    adding.value = { username: '', name: '', password: '' };
    await load();
  } catch (e) {
    report(e);
  }
}

async function reset() {
  if (!resetting.value) return;
  try {
    await api(`users/${encodeURIComponent(resetting.value.username)}`, {
      method: 'PUT',
      body: { password: resetting.value.password },
    });
    toast(`Password reset; ${resetting.value.username} is signed out everywhere`);
    resetting.value = null;
  } catch (e) {
    report(e);
  }
}

async function remove(username: string) {
  try {
    await api(`users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    toast(`Deleted ${username}`);
    confirmDelete.value = '';
    await load();
  } catch (e) {
    report(e);
  }
}

async function changeOwn() {
  if (own.value.next !== own.value.again) return toast('The new passwords don’t match');
  try {
    await api('account/password', { body: { current: own.value.current, next: own.value.next } });
    toast('Password changed; your other devices are signed out');
    own.value = { current: '', next: '', again: '' };
  } catch (e) {
    report(e);
  }
}

onMounted(load);
</script>

<template>
  <AdminShell :ctx="ctx" active="users" title="Users">
    <section class="adm-form" aria-labelledby="adm-accounts">
      <h2 id="adm-accounts" class="adm-h2">Accounts</h2>
      <table class="adm-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Name</th>
            <th>Created</th>
            <th><span class="adm-visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in accounts" :key="a.username">
            <td>{{ a.username }}</td>
            <td>{{ a.name }}</td>
            <td>{{ new Date(a.created_at).toLocaleDateString() }}</td>
            <td class="adm-actions">
              <template v-if="resetting?.username === a.username">
                <input
                  v-model="resetting.password"
                  type="password"
                  autocomplete="new-password"
                  :aria-label="`New password for ${a.username}`"
                  placeholder="New password (12+ characters)"
                />
                <button type="button" class="adm-btn adm-btn-small adm-btn-primary" @click="reset">Save</button>
                <button type="button" class="adm-btn adm-btn-small" @click="resetting = null">Cancel</button>
              </template>
              <template v-else-if="confirmDelete === a.username">
                <span>Delete {{ a.username }}?</span>
                <button type="button" class="adm-btn adm-btn-small" @click="remove(a.username)">Delete</button>
                <button type="button" class="adm-btn adm-btn-small" @click="confirmDelete = ''">Cancel</button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="adm-btn adm-btn-small"
                  @click="resetting = { username: a.username, password: '' }"
                >
                  Reset password
                </button>
                <button type="button" class="adm-btn adm-btn-small" @click="confirmDelete = a.username">Delete</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="githubAdmins.length" class="adm-muted">
        GitHub admins (managed in config/site.yml): {{ githubAdmins.join(', ') }}
      </p>
    </section>

    <form class="adm-card adm-form" aria-labelledby="adm-add" @submit.prevent="add">
      <h2 id="adm-add" class="adm-h2">Add an account</h2>
      <label class="adm-field"><span>Username</span><input v-model="adding.username" required autocapitalize="none" /></label>
      <label class="adm-field"><span>Display name</span><input v-model="adding.name" /></label>
      <label class="adm-field">
        <span>Initial password</span>
        <input v-model="adding.password" type="password" autocomplete="new-password" required />
        <small>At least 12 characters. They can change it after signing in.</small>
      </label>
      <div class="adm-actions"><button type="submit" class="adm-btn adm-btn-primary">Add account</button></div>
    </form>

    <form v-if="isPassword" class="adm-card adm-form" aria-labelledby="adm-own" @submit.prevent="changeOwn">
      <h2 id="adm-own" class="adm-h2">Change your password</h2>
      <label class="adm-field">
        <span>Current password</span>
        <input v-model="own.current" type="password" autocomplete="current-password" required />
      </label>
      <label class="adm-field">
        <span>New password</span>
        <input v-model="own.next" type="password" autocomplete="new-password" required />
      </label>
      <label class="adm-field">
        <span>New password again</span>
        <input v-model="own.again" type="password" autocomplete="new-password" required />
      </label>
      <div class="adm-actions"><button type="submit" class="adm-btn adm-btn-primary">Change password</button></div>
    </form>
  </AdminShell>
</template>
```

If a class above (e.g. `adm-actions` on a `td`) doesn't exist in `src/admin/admin.css`, use the closest existing class rather than adding CSS.

- [ ] **Step 4: Verify**

Run: `pnpm test` → PASS. `pnpm lint` → no new errors. Run the git-mode and Postgres-mode Vercel builds, then plain `pnpm build`, as in Task 3 Step 4.

- [ ] **Step 5: Commit**

```bash
git add src/admin/routes/api/users.ts "src/admin/routes/api/users/[username].ts" src/admin/routes/api/account/password.ts src/admin/Users.vue src/admin/AdminShell.vue src/admin/types.ts "src/admin/routes/[...path].astro" src/lib/admin/accounts.ts src/lib/admin/users-routes.test.ts
git commit -m "feat(accounts): Users screen to add, reset and delete accounts; change your own password"
```

---

### Task 5: `pnpm dev:postgres` and `pnpm admin:create-user`

**Files:**
- Create: `src/lib/dev-env.ts`, `src/lib/dev-env.test.ts`, `scripts/dev-postgres.ts`, `scripts/admin-create-user.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `migrate` (db-migrate.ts); `createAccount`, `resetPassword` (Task 1).
- Produces (`dev-env.ts`):
  - `devEnv(fileEnv: Record<string, string | undefined>, shellEnv: NodeJS.ProcessEnv, generateSecret?: () => string): Record<string, string>` (throws `Error` naming `DEV_DATABASE_URL` when missing)
  - `databaseFor(env: Record<string, string | undefined>, production: boolean): string`
  - `hostOf(url: string): string`
  - `confirmsProduction(typed: string, username: string): boolean`

- [ ] **Step 1: Write the failing tests**

`src/lib/dev-env.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmsProduction, databaseFor, devEnv, hostOf } from './dev-env';

const DEV = 'postgres://u:p@ep-dev-123.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const PROD = 'postgres://u:p@ep-main-999.eu-central-1.aws.neon.tech/neondb?sslmode=require';

test('devEnv: DATABASE_URL is always DEV_DATABASE_URL, never the pulled or shell one', () => {
  const env = devEnv(
    { DATABASE_URL: PROD, DEV_DATABASE_URL: DEV, SESSION_SECRET: 's'.repeat(40), BLOB_READ_WRITE_TOKEN: 'blob' },
    { DATABASE_URL: PROD, PATH: '/bin' },
  );
  assert.equal(env.DATABASE_URL, DEV);
  assert.equal(env.VERCEL, '1');
  assert.equal(env.BLOB_READ_WRITE_TOKEN, 'blob');
  assert.equal(env.SESSION_SECRET, 's'.repeat(40));
  assert.equal(env.PATH, '/bin');
});

test('devEnv: missing DEV_DATABASE_URL is an error that says what to do; missing SESSION_SECRET is generated', () => {
  assert.throws(() => devEnv({ DATABASE_URL: PROD }, {}), /DEV_DATABASE_URL/);
  const env = devEnv({ DEV_DATABASE_URL: DEV }, {}, () => 'g'.repeat(43));
  assert.equal(env.SESSION_SECRET, 'g'.repeat(43));
});

test('databaseFor / hostOf / confirmsProduction', () => {
  assert.equal(databaseFor({ DEV_DATABASE_URL: DEV, DATABASE_URL: PROD }, false), DEV);
  assert.equal(databaseFor({ DEV_DATABASE_URL: DEV, DATABASE_URL: PROD }, true), PROD);
  assert.throws(() => databaseFor({ DATABASE_URL: PROD }, false), /DEV_DATABASE_URL/);
  assert.throws(() => databaseFor({ DEV_DATABASE_URL: DEV }, true), /DATABASE_URL/);
  assert.equal(hostOf(DEV), 'ep-dev-123.eu-central-1.aws.neon.tech');
  assert.equal(confirmsProduction(' Jane ', 'jane'), true);
  assert.equal(confirmsProduction('jan', 'jane'), false);
});
```

Run: `pnpm exec tsx --test src/lib/dev-env.test.ts` → FAIL.

- [ ] **Step 2: Implement `dev-env.ts`**

```ts
import { randomBytes } from 'node:crypto';

type Env = Record<string, string | undefined>;

const PASS_THROUGH = [
  'SESSION_SECRET',
  'BLOB_READ_WRITE_TOKEN',
  'CRON_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'MEDIUM_TOKEN',
];

const MISSING_DEV =
  'DEV_DATABASE_URL is not set. Create a `dev` branch in the Neon console and add its connection string to .env.local ' +
  'as DEV_DATABASE_URL (the DATABASE_URL that `vercel env pull` writes is production and is never used locally).';

/**
 * The environment for `astro dev` in Postgres mode: the shell's, the pulled secrets, VERCEL=1, and DATABASE_URL set
 * to DEV_DATABASE_URL — never to a DATABASE_URL from .env.local or the shell (that one is production).
 */
export function devEnv(fileEnv: Env, shellEnv: NodeJS.ProcessEnv, generateSecret = () => randomBytes(32).toString('base64url')): Record<string, string> {
  const pick = (k: string) => shellEnv[k] ?? fileEnv[k];
  const dev = pick('DEV_DATABASE_URL');
  if (!dev) throw new Error(MISSING_DEV);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(shellEnv)) if (v !== undefined) out[k] = v;
  for (const k of PASS_THROUGH) {
    const v = pick(k);
    if (v) out[k] = v;
  }
  out.SESSION_SECRET = pick('SESSION_SECRET') || generateSecret();
  out.VERCEL = '1';
  out.DATABASE_URL = dev;
  return out;
}

/** Scripts default to the dev branch; `--production` targets DATABASE_URL on purpose. */
export function databaseFor(env: Env, production: boolean): string {
  const url = production ? env.DATABASE_URL : env.DEV_DATABASE_URL;
  if (!url) throw new Error(production ? 'DATABASE_URL is not set (run `vercel env pull .env.local`).' : MISSING_DEV);
  return url;
}

export const hostOf = (url: string) => new URL(url).host;

export const confirmsProduction = (typed: string, username: string) =>
  typed.trim().toLowerCase() === username.trim().toLowerCase();
```

Run the test → PASS.

- [ ] **Step 3: Scripts**

`scripts/dev-postgres.ts`:

```ts
#!/usr/bin/env tsx
/** pnpm dev:postgres — `astro dev` in Postgres mode against the Neon dev branch (DEV_DATABASE_URL in .env.local). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { migrate } from '../src/lib/db-migrate';
import type { Sql } from '../src/lib/db';
import { devEnv, hostOf } from '../src/lib/dev-env';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = path.join(ROOT, '.env.local');
const fileEnv = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
let env: Record<string, string>;
try {
  env = devEnv(fileEnv, process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
if (!fileEnv.SESSION_SECRET && !process.env.SESSION_SECRET) {
  console.log('No SESSION_SECRET in .env.local: using a temporary one (sessions end when this server stops).');
}
console.log(`Postgres mode on the dev branch: ${hostOf(env.DATABASE_URL)}`);
const client = postgres(env.DATABASE_URL, { max: 1, prepare: false });
try {
  const applied = await migrate(client as unknown as Sql, path.join(ROOT, 'migrations'));
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
} finally {
  await client.end();
}
const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/astro/astro.js'), 'dev', ...process.argv.slice(2)], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
```

Check that `node_modules/astro/astro.js` exists. If the entry is named differently, use the path that `node_modules/.bin/astro` points to.

`scripts/admin-create-user.ts`:

```ts
#!/usr/bin/env tsx
/**
 * pnpm admin:create-user <username> [--reset] [--production]
 * Creates a password account (or with --reset sets a new password) on the dev branch (DEV_DATABASE_URL), or with
 * --production on DATABASE_URL after you type the username again.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { createAccount, resetPassword } from '../src/lib/admin/accounts';
import { migrate } from '../src/lib/db-migrate';
import type { Sql } from '../src/lib/db';
import { confirmsProduction, databaseFor, hostOf } from '../src/lib/dev-env';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'));
const production = args.includes('--production');
const resetting = args.includes('--reset');
if (!username) {
  console.error('Usage: pnpm admin:create-user <username> [--reset] [--production]');
  process.exit(1);
}
const file = path.join(ROOT, '.env.local');
const env = { ...(fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {}), ...process.env };

function ask(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
    if (s.startsWith(question)) process.stdout.write(question);
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

let url: string;
try {
  url = databaseFor(env, production);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
console.log(`${production ? 'PRODUCTION' : 'Dev branch'} database: ${hostOf(url)}`);
if (production && !confirmsProduction(await ask(`Type the username (${username}) to confirm: `), username)) {
  console.error('Not confirmed; nothing written.');
  process.exit(1);
}
const name = resetting ? '' : await ask('Display name: ');
const password = await ask('Password (12+ characters): ', true);
if ((await ask('Password again: ', true)) !== password) {
  console.error('The passwords don’t match; nothing written.');
  process.exit(1);
}
const client = postgres(url, { max: 1, prepare: false });
const sql = client as unknown as Sql;
try {
  await migrate(sql, path.join(ROOT, 'migrations'));
  if (resetting) {
    await resetPassword(sql, username, password);
    console.log(`New password set for ${username}; their sessions have ended.`);
  } else {
    const account = await createAccount(sql, username, name, password);
    console.log(`Created ${account.username}. Sign in at /<adminPath>/login.`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
```

`package.json` → `scripts`: add `"dev:postgres": "tsx scripts/dev-postgres.ts",` after `"dev"`, and `"admin:create-user": "tsx scripts/admin-create-user.ts",` after `"db:export"`.

- [ ] **Step 4: Verify the scripts' guard rails**

- Run: `mv .env.local /tmp/env.local.bak 2>/dev/null; pnpm dev:postgres; echo "exit $?"; mv /tmp/env.local.bak .env.local 2>/dev/null`. Expected: the DEV_DATABASE_URL message and `exit 1`. Move any real `.env.local` back exactly as it was.
- Run: `DEV_DATABASE_URL= pnpm admin:create-user someone < /dev/null; echo "exit $?"`. Expected: the DEV_DATABASE_URL message and exit 1, unless `.env.local` defines `DEV_DATABASE_URL`; the shell's empty value doesn't override a file value, so say which case you observed.
- Run `pnpm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dev-env.ts src/lib/dev-env.test.ts scripts/dev-postgres.ts scripts/admin-create-user.ts package.json
git commit -m "feat(dev): pnpm dev:postgres on the Neon dev branch; pnpm admin:create-user"
```

---

### Task 6: CV PDF follow-ups

**Files:**
- Modify: `src/lib/cv-pdf/generate.ts`, `src/lib/cv-pdf/generate.test.ts`, `src/lib/cv-pdf/render.ts`, `src/lib/admin/http.ts`, `src/admin/routes/api/cv/pdf.ts`, `src/admin/Cv.vue`, `src/admin/api.test.ts`

**Interfaces:**
- Changes: `generateCvPdf(store, now?)` now returns `Promise<{ meta: CvMetadata; purgeFailed?: string[] }>` (`purgeFailed`: the tags of the `cv.json` save whose cache purge failed).
- `POST /api/admin/cv/pdf` in Postgres mode → `{ pdf: CvMetadata, warning?: 'cache-purge-failed', tags?: string[] }`; `ConflictError` passes through as 409.

- [ ] **Step 1: Write the failing tests**

In `src/lib/cv-pdf/generate.test.ts`:
- Add `/* eslint-disable no-console -- the tests silence expected error logs */` as the first line.
- Every use of the result of `generateCvPdf(...)` reads `.meta` (e.g. `const result = (await generateCvPdf(...)).meta`, `first.pdfPath` → `(await generateCvPdf(...)).meta.pdfPath`).
- Add a `purgeFails: (tags: string[]) => boolean` switch to `deps()`: `purge: async (tags) => { if (purgeFails(tags)) throw new Error('purge down'); purged.push(tags); }`, reset to `() => false` in `beforeEach`.
- Append:

```ts
test('site.yml saves regenerate the PDF (the author is bold in it)', async () => {
  const { data, version } = await (await call(getConfig, { params: { file: 'site' } })).json();
  assert.equal((await call(putConfig, { method: 'PUT', params: { file: 'site' }, body: { data, version } })).status, 200);
  assert.ok(await store.read(CV_JSON));
});

test('a cv-upload.yml-only save regenerates the PDF', async () => {
  const { data, version } = await (await call(getConfig, { params: { file: 'cv-upload' } })).json();
  assert.equal((await call(putConfig, { method: 'PUT', params: { file: 'cv-upload' }, body: { data, version } })).status, 200);
  assert.ok(await store.read(CV_JSON));
});

test('a failed purge of the save itself wins over a PDF failure', async () => {
  purgeFails = () => true;
  putFails = true;
  const res = await quiet(saveCv);
  const body = await res.json();
  assert.equal(body.warning, 'cache-purge-failed');
});

test('a failed purge of cv.json is reported as the save’s warning', async () => {
  purgeFails = (tags) => tags.includes('data:cv');
  const body = await (await quiet(saveCv)).json();
  assert.equal(body.warning, 'cache-purge-failed');
  assert.deepEqual(body.tags, ['data:cv']);
});

test('if cv.json can’t be saved after the upload, the new PDF is deleted — never one the site already links to', async () => {
  const first = (await generateCvPdf(store, new Date('2026-10-07T00:00:00Z'))).meta;
  const failing = new PostgresStore(sql, { name: 'Jane', email: 'j@x' }, deps());
  failing.commit = async () => {
    throw new Error('db down');
  };
  await assert.rejects(quiet(() => generateCvPdf(failing, new Date('2026-10-08T00:00:00Z'))), /db down/);
  assert.equal(deleted.length, 1, 'the just-uploaded PDF');
  assert.notEqual(deleted[0], first.pdfPath);
  deleted.length = 0;
  await assert.rejects(quiet(() => generateCvPdf(failing, new Date('2026-10-07T00:00:00Z'))), /db down/);
  assert.deepEqual(deleted, [], 'same bytes, same name: the stored PDF stays');
});

test('cv/pdf: a concurrent save answers 409, not 502', async () => {
  const racing = new PostgresStore(sql, { name: 'Jane', email: 'j@x' }, deps());
  racing.commit = async () => {
    throw new ConflictError(CV_JSON);
  };
  setStoreForTests(() => racing);
  assert.equal((await quiet(() => call(generatePdf, { method: 'POST' }))).status, 409);
});
```

Import `ConflictError` from `'../admin/store'`. The `'same bytes'` case needs the second failing run to render the same bytes as `first`: same `now` → same `creationDate` → same hash → `putMedia` returns the existing row with `commit: null`.

Append to `src/admin/api.test.ts`:

```ts
test('a PDF failure after a save says the save stands', () => {
  session.mode = 'postgres';
  committed({ warning: 'pdf-failed', detail: 'quota exceeded' });
  assert.equal(toasts[0].text, 'Saved; PDF generation failed: quota exceeded');
});
```

Run: `pnpm exec tsx --test src/lib/cv-pdf/generate.test.ts src/admin/api.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`src/lib/cv-pdf/generate.ts`:
- `affectsCvPdf` adds `p === 'config/site.yml'`, and its doc comment says why: "the author is bold".
- `generateCvPdf` returns `{ meta, purgeFailed }`:
  ```ts
  const upload = await store.putMedia('site', `cv/cv-${hash}.pdf`, Buffer.from(bytes).toString('base64'), 'application/pdf');
  const meta: CvMetadata = { lastGenerated: now.toISOString(), pdfPath: upload.url, pdfSize: bytes.length };
  let saved;
  try {
    saved = await store.commit([{ path: CV_JSON, content: `${JSON.stringify(meta, null, 2)}\n` }], 'Generate CV PDF', {
      [CV_JSON]: current?.version ?? null,
    });
  } catch (e) {
    // Only a PDF this run created (`commit` set) is removed: a reused name is the PDF the site links to now.
    if (upload.commit) await store.deleteMedia(upload.url, '1').catch((err) => console.error('[cv-pdf] cleanup failed', err));
    throw e;
  }
  ```
  Keep the `eslint-disable-next-line no-console` comments on `console.error` lines. Keep the previous-PDF deletion, using `upload.url`. Return `{ meta, ...(saved.warning === 'cache-purge-failed' ? { purgeFailed: saved.tags ?? [] } : {}) }`, and update the doc comment.

`src/lib/admin/http.ts` `commitChanges`, PDF branch:
```ts
  try {
    const pdf = await generateCvPdf(store);
    if (pdf.purgeFailed && !result.warning) return { ...result, warning: 'cache-purge-failed', tags: pdf.purgeFailed };
    return result;
  } catch (e) { … unchanged … }
```

`src/admin/routes/api/cv/pdf.ts` POST, Postgres branch:
```ts
    try {
      const { meta, purgeFailed } = await generateCvPdf(store);
      return json({ pdf: meta, ...(purgeFailed ? { warning: 'cache-purge-failed', tags: purgeFailed } : {}) });
    } catch (e) {
      if (e instanceof UpstreamError || e instanceof ConflictError) throw e;
      throw new HttpError(502, `PDF generation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
```
(import `ConflictError` from the store module).

`src/lib/cv-pdf/render.ts`: `pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(FONTS + path.sep));`.

`src/admin/Cv.vue`:
- `generatePdf` (Postgres branch): after setting `pdfMeta`, `if (result.warning) committed(result); else toast('PDF updated', pdfMeta.value.pdfPath);`. Type the API result as `{ pdf: CvMetadata; warning?: 'cache-purge-failed'; tags?: string[] }`, and import `committed` if not yet imported.
- `<DocBanners … @reload="reloadCv" />` with
  ```ts
  /** History restore and conflict reload: the document and the PDF info both changed. */
  async function reloadCv() {
    await doc.reload();
    void checkPdf();
  }
  ```

- [ ] **Step 3: Run tests**

Run: `pnpm exec tsx --test src/lib/cv-pdf/generate.test.ts src/lib/cv-pdf/cv-pdf.test.ts src/admin/api.test.ts src/lib/admin/routes.test.ts src/lib/admin/routes-postgres.test.ts` → PASS. Then `pnpm test`, `pnpm lint`, and the git-mode Vercel build to compile Cv.vue, then plain `pnpm build`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cv-pdf src/lib/admin/http.ts src/admin/routes/api/cv/pdf.ts src/admin/Cv.vue src/admin/api.test.ts
git commit -m "fix(cv-pdf): regenerate on site.yml, clean up after failed saves, surface cv.json purge failures, 409 on races"
```

---

### Task 7: Daily-jobs follow-ups and demo feeds

**Files:**
- Modify: `src/lib/admin/jobs.ts`, `src/lib/admin/jobs.test.ts`, `src/lib/admin/backup.ts`, `config/feeds.yml`

- [ ] **Step 1: Write the failing tests**

In `src/lib/admin/jobs.test.ts` add `/* eslint-disable no-console -- the tests silence expected error logs */` as the first line, add `parseJobs` to the `./jobs` import, and append:

```ts
test('parseJobs keeps only well-formed step records', () => {
  const at = '2026-10-07T03:00:00.000Z';
  assert.deepEqual(
    parseJobs(
      JSON.stringify({
        scheduled: { ok: true, at, detail: 'nothing due' },
        feeds: { ok: 'yes', at },
        backup: { ok: true, at: 'not a date' },
        extra: { ok: true, at },
      }),
    ),
    { scheduled: { ok: true, at, detail: 'nothing due' } },
  );
  assert.deepEqual(parseJobs('[1,2]'), {});
  assert.deepEqual(parseJobs('{'), {});
});

test('releaseScheduled: a post dated exactly `since` is not released; one dated exactly `now` is', async () => {
  await sql`insert into documents (path, content) values
    ('src/content/posts/at-since.md', ${post('2026-10-06T03:00:00Z')}),
    ('src/content/posts/at-now.md', ${post('2026-10-07T03:00:00Z')})`;
  const due = await releaseScheduled(store(), new Date('2026-10-06T03:00:00Z'), new Date('2026-10-07T03:00:00Z'));
  assert.deepEqual(due, ['at-now']);
});

test('cron answers 502 when a step fails; Run now writes jobs.json', async () => {
  const restore = env({ CRON_SECRET: 's3cret', VERCEL: '1', DATABASE_URL: 'postgres://test', GITHUB_TOKEN: undefined });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  await sql`insert into documents (path, content) values ('config/feeds.yml', ${"feeds:\n  - name: 'X'\n    url: 'https://x.test/feed'\n"})`;
  const original = console.error;
  console.error = () => {};
  try {
    const res = await cron({
      request: new Request('https://site.test/x', { headers: { authorization: 'Bearer s3cret' } }),
    } as never);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).feeds.ok, false);
    await sql`delete from documents where path = ${JOBS_JSON}`;
    const run = await runNow({
      request: new Request('https://site.test/api/admin/jobs/run', { method: 'POST' }),
      url: new URL('https://site.test/api/admin/jobs/run'),
      params: {},
      locals: { user: { login: 'jane', name: 'Jane', avatar: '', provider: 'github' } },
    } as never);
    assert.equal(run.status, 200);
    assert.ok(await store().read(JOBS_JSON), 'Run now recorded jobs.json');
  } finally {
    console.error = original;
    globalThis.fetch = realFetch;
    restore();
  }
});
```

Adapt to the file's existing helpers (`post`, `store`, `env`, `cron`, `runNow` imports). Note the `post()` helper writes `date: <value>` unquoted; ISO datetimes are valid YAML scalars there.

Run: `pnpm exec tsx --test src/lib/admin/jobs.test.ts` → FAIL (parseJobs keeps malformed records).

- [ ] **Step 2: Implement**

`src/lib/admin/jobs.ts`:

```ts
const isStep = (v: unknown): v is StepResult => {
  const s = v as Partial<StepResult> | null;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.ok === 'boolean' &&
    typeof s.at === 'string' &&
    !Number.isNaN(Date.parse(s.at)) &&
    (s.detail === undefined || typeof s.detail === 'string') &&
    (s.url === undefined || typeof s.url === 'string')
  );
};

/** jobs.json, keeping only well-formed step records (it is on the admin's write allowlist, so it may be hand-edited). */
export function parseJobs(text: string | undefined): JobsRecord {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  return Object.fromEntries(JOBS.filter((name) => isStep(record[name])).map((name) => [name, record[name]]));
}
```

`src/lib/admin/backup.ts`: remove `skipped?` and `error?` from `BackupResult`.

`config/feeds.yml`:

```yaml
mediumUrl: '' # e.g. https://medium.com/feed/@username

# RSS/Atom feeds shown on the Writing page. Examples:
#   - name: "Jane Smith's Blog"
#     url: 'https://example.com/feed.xml'
#     author: 'jane-smith'
#     tags: ['blog']
#   - name: 'Lab Medium Publication'
#     url: 'https://medium.com/feed/@example-lab'
#     author: null
#     tags: ['medium']
feeds: []

syncInterval: 'daily'
maxItemsPerFeed: 20
```

Keep any other keys the current file has (compare with `git show HEAD:config/feeds.yml`).

- [ ] **Step 3: Run tests and builds**

Run: `pnpm exec tsx --test src/lib/admin/jobs.test.ts src/lib/admin/backup.test.ts src/lib/schemas.test.ts src/lib/feeds.test.ts` → PASS. Then `pnpm test`, and `pnpm build` (the demo `src/data/feeds.json` items still render; only future syncs see no sources).

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/jobs.ts src/lib/admin/jobs.test.ts src/lib/admin/backup.ts config/feeds.yml
git commit -m "fix(jobs): validate jobs.json, drop dead backup fields, test edges; demo site ships without placeholder feeds"
```

---

### Task 8: Medium follow-ups

**Files:**
- Modify: `src/lib/admin/medium.ts`, `src/lib/admin/medium.test.ts`, `src/admin/routes/api/posts/[slug]/medium.ts`, `src/lib/utils.ts`, `src/lib/utils.test.ts`, `src/admin/PostEditor.vue`

**Interfaces:**
- Route body: optional `{ version?: string }`. New answers: 409 "The post is still saving; try again in a moment" (version never matched after 3 reads); 400 "Send this post to Medium once it is live (<YYYY-MM-DD>)"; the "saving the link failed" 502 carries `details: { url }`.
- Produces: `readEntryAt(store, slug, version, opts?: { tries?: number; delayMs?: number })` (in the route file, exported for tests).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/admin/medium.test.ts` (reuse the file's `call`, `seed`, `fakeFetch`, `OK` helpers; extend `call` to accept an optional body: `call(slug, body?)` → `new Request(…, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })`):

```ts
test('absoluteUrls: code spans and fenced blocks untouched; balanced parentheses in targets', () => {
  const md = 'See [x](/a) and `[y](/b)`.\n\n```\n![z](/c)\n```\n\n[wiki](/w/Foo_(bar))';
  const out = absoluteUrls(md, 'https://example.com/blog/p/');
  assert.match(out, /\[x\]\(https:\/\/example\.com\/a\)/);
  assert.match(out, /`\[y\]\(\/b\)`/);
  assert.match(out, /```\n!\[z\]\(\/c\)\n```/);
  assert.match(out, /\[wiki\]\(https:\/\/example\.com\/w\/Foo_\(bar\)\)/);
});

test('route: scheduled posts are refused until their date', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN };
  process.env.MEDIUM_TOKEN = 'tok';
  try {
    await seed('later', 'title: Later\ndate: 2999-01-01');
    const res = await call('later');
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /once it is live \(2999-01-01\)/);
  } finally {
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    else process.env.MEDIUM_TOKEN = saved.token;
  }
});

test('route: MDX posts 409; a version that never shows up 409 "still saving"', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN };
  process.env.MEDIUM_TOKEN = 'tok';
  try {
    await store.commit([{ path: 'src/content/posts/old.mdx', content: '---\ntitle: Old\ndate: 2024-01-01\n---\n' }], 's', {});
    assert.equal((await call('old')).status, 409);
    await seed('hello', 'title: Hello\ndate: 2024-06-01');
    const res = await call('hello', { version: 'not-the-version' });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /still saving/);
  } finally {
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    else process.env.MEDIUM_TOKEN = saved.token;
  }
});

test('route: without siteUrl the canonical URL uses the request origin', async () => {
  const saved = { token: process.env.MEDIUM_TOKEN, fetch: globalThis.fetch };
  process.env.MEDIUM_TOKEN = 'tok';
  const seen: Request[] = [];
  globalThis.fetch = fakeFetch(OK, seen);
  try {
    const site = (await store.read('config/site.yml'))!;
    await store.commit(
      [{ path: 'config/site.yml', content: site.content.replace(/^siteUrl:.*$/m, "siteUrl: ''") }],
      's',
      { 'config/site.yml': site.version },
    );
    await seed('hello', 'title: Hello\ndate: 2024-06-01');
    assert.equal((await call('hello')).status, 200);
    assert.equal((await seen[1].json()).canonicalUrl, 'https://site.test/blog/hello/');
  } finally {
    if (saved.token === undefined) delete process.env.MEDIUM_TOKEN;
    else process.env.MEDIUM_TOKEN = saved.token;
    globalThis.fetch = saved.fetch;
  }
});
```

The route's `readEntryAt` default delay makes the "still saving" test wait about 1 s. Acceptable; don't add test-only knobs to the route.

Append to `src/lib/utils.test.ts`:

```ts
test('withoutCrossPosted: http/https and www. are the same link; empty titles never match', () => {
  const item = (link: string, title: string) => ({ id: link, data: { link, title } });
  const posts = [
    { data: { title: 'Hello', medium: { url: 'https://medium.com/@jane/hello-1' } } },
    { data: { title: '!!!', medium: { url: 'https://medium.com/@jane/bang-2' } } },
  ];
  const kept = withoutCrossPosted(
    [item('http://www.medium.com/@jane/hello-1', 'Different title'), item('https://x.test/a', '???')],
    posts,
  );
  assert.deepEqual(kept.map((i) => i.data.title), ['???']);
});
```

Run: `pnpm exec tsx --test src/lib/admin/medium.test.ts src/lib/utils.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`src/lib/admin/medium.ts` `absoluteUrls`:

```ts
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
const TARGET = /(\]\(\s*)((?:[^()\s]|\([^()\s]*\))+)/g;

/**
 * Relative Markdown link/image targets and HTML src/href values made absolute against `base` (the post URL). Code
 * spans and fenced blocks are left exactly as written; targets may contain one level of balanced parentheses.
 */
export function absoluteUrls(markdown: string, base: string): string {
  return markdown
    .split(CODE)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(TARGET, (_, open: string, target: string) => open + absolute(target, base))
            .replace(/(\s(?:src|href)=")([^"]+)"/g, (_, open: string, target: string) => `${open}${absolute(target, base)}"`),
    )
    .join('');
}
```

`src/admin/routes/api/posts/[slug]/medium.ts`:
- Read the optional body: `const { version } = await readBody<{ version?: unknown }>(ctx).catch(() => ({ version: undefined }))` (import `readBody`).
- Replace `readEntry(store, 'posts', slug)` with `readEntryAt(store, slug, typeof version === 'string' ? version : undefined)`:
  ```ts
  /** Git mode: GitHub can serve the file from just before the editor's save; wait briefly for that save's version. */
  export async function readEntryAt(
    store: ContentStore,
    slug: string,
    version: string | undefined,
    { tries = 3, delayMs = 500 } = {},
  ) {
    for (let i = 0; ; i++) {
      const entry = await readEntry(store, 'posts', slug);
      if (!entry || version === undefined || entry.version === version) return entry;
      if (i === tries - 1) throw new HttpError(409, 'The post is still saving; try again in a moment');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  ```
- After the draft check:
  ```ts
  if (!isPublished({ data: entry.data as { date: string } })) {
    const day = new Date(String(entry.data.date)).toISOString().slice(0, 10);
    throw new HttpError(400, `Send this post to Medium once it is live (${day})`);
  }
  ```
  Import `isPublished` from `../../../../../lib/utils`. If `entry.data.date` is invalid, `isPublished` is false and `toISOString` would throw, so guard with `Number.isNaN(Date.parse(String(entry.data.date)))`: on an invalid date, use the raw value in the message.
- The final catch: `throw new HttpError(502, …same message…, { url: medium.url });`.

`src/lib/utils.ts`:
- `normalLink` adds `.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '')` right after `.trim()`, and its doc comment mentions scheme and `www.`.
- In `withoutCrossPosted`: `const titles = new Set(crossPosted.map((p) => normalTitle(p.data.title)).filter(Boolean));`, and the filter checks `const t = normalTitle(i.data.title); … && !(t && titles.has(t))`.

`src/admin/PostEditor.vue`:
- Import `ApiError` from `'./api'`.
- `sendToMedium` sends `{ body: { version: doc.version } }` (with `method: 'POST'`), and its catch becomes:
  ```ts
  } catch (e) {
    const url = e instanceof ApiError ? (e.details as { url?: string } | undefined)?.url : undefined;
    if (e instanceof ApiError && e.status === 409 && url) {
      await doc.reload(); // it is already linked: show the stored link
      return toast('Already on Medium', url);
    }
    if (e instanceof ApiError && e.status === 502 && url) {
      return toast(`${e.message}`, url); // sent, but not recorded: no Retry (it would make a second draft)
    }
    toast(`Published; Medium cross-post failed: ${e instanceof Error ? e.message : String(e)}`, undefined, {
      label: 'Retry',
      run: () => void sendToMedium(),
    });
  }
  ```
- The checkbox renders only for posts that aren't scheduled: `<label v-else-if="!scheduled" class="adm-check">…</label>`, then `<small v-else class="adm-muted">Medium cross-posting is available once the post is live.</small>`.

- [ ] **Step 3: Run tests and build**

Run: `pnpm exec tsx --test src/lib/admin/medium.test.ts src/lib/utils.test.ts src/lib/content/content.test.ts` → PASS. Then `pnpm test`, `pnpm lint`, the git-mode Vercel build (compiles PostEditor.vue), then `pnpm build`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/medium.ts src/lib/admin/medium.test.ts "src/admin/routes/api/posts/[slug]/medium.ts" src/lib/utils.ts src/lib/utils.test.ts src/admin/PostEditor.vue
git commit -m "fix(medium): wait for the saved version, no cross-post before the date, no duplicate-making Retry, code-safe URLs"
```

---

### Task 9: CI, docs and full verification

**Files:**
- Modify: `.github/workflows/sync-template.yml`, `README.md`, `.env.example`

- [ ] **Step 1: Template sync keeps binary files**

`.github/workflows/sync-template.yml`: both `git diff "$…" "$TEMPLATE_SHA" -- . "${EXCLUDE[@]}" > /tmp/template.patch` lines get `--binary` right after `git diff`. Validate: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/sync-template.yml','utf8'));console.log('ok')"`.

- [ ] **Step 2: `.env.example`**

Append:

```bash

# Local development in Postgres mode (`pnpm dev:postgres`): the connection string of a Neon `dev` branch.
# The DATABASE_URL that `vercel env pull` writes is production and is never used locally.
DEV_DATABASE_URL=
```

- [ ] **Step 3: README**

- Wrap the long Postgres-mode step-1 line at about 120 characters, without changing its text.
- After the "Postgres mode" subsection's notes, add:

```markdown
### Admin accounts (Postgres mode)

In Postgres mode you can sign in with a username and password instead of GitHub (GitHub sign-in keeps working when
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are set).

1. Apply the migration once: `pnpm db:migrate` (uses `DATABASE_URL` from `.env.local`, i.e. production).
2. Create the first account: `pnpm admin:create-user <username> --production` (asks for a display name and a
   password of at least 12 characters; you confirm by typing the username again).
3. Sign in at `https://<your-domain>/<adminPath>/login`.

The **Users** screen adds accounts, resets passwords and deletes accounts; everyone can change their own password
there. Resetting or changing a password signs that account out on its other devices. After 10 failed sign-ins for a
username within 15 minutes, that username is refused until the window passes.

### Local development against Neon

1. In the Neon console, create a branch named `dev` from `main` (a copy of your live content).
2. `vercel link`, then `vercel env pull .env.local --environment=preview`.
3. Add `DEV_DATABASE_URL=<the dev branch's connection string>` to `.env.local`.
4. `pnpm admin:create-user <username>` (on the dev branch), then `pnpm dev:postgres`.

`pnpm dev:postgres` runs the site in Postgres mode against the dev branch only: it never uses the `DATABASE_URL`
from `.env.local` (production). Uploads (images, the CV PDF) go to your Blob store.
```

- [ ] **Step 4: Full verification**

Run and report each:
- `pnpm test` → all PASS.
- `python3 scripts/test_render_cv.py` → exit 0.
- `pnpm lint` → no errors (warning count not above the starting count).
- `rm -rf .vercel/output && VERCEL=1 SESSION_SECRET=ci-build-only-not-a-real-secret-0000 pnpm build && test -e .vercel/output/static/index.html && echo GIT-OK`
- `rm -rf .vercel/output && VERCEL=1 DATABASE_URL=postgres://ci@localhost:1/ci SESSION_SECRET=ci-build-only-not-a-real-secret-0000 pnpm build && test ! -e .vercel/output/static/index.html && test -f .vercel/output/functions/_render.func/src/lib/cv-pdf/fonts/SourceSerif4-Regular.ttf && echo PG-OK`
- `pnpm build` (static, last).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/sync-template.yml README.md .env.example
git commit -m "docs: admin accounts and local Neon development; template sync keeps binary files"
```

- [ ] **Step 6: Manual checks (for the owner, not the implementer)**

On the `dev` branch via `pnpm dev:postgres`:
1. Sign in with the password account.
2. Add a second account, sign in with it in a private window, reset its password from the first window, and confirm the private window is signed out on its next click.
3. Change your own password; your other session is signed out and this one stays.
4. Generate PDF, Run now, and Medium import.

Then on production: `pnpm db:migrate`, `pnpm admin:create-user <you> --production`, and sign in on the live site.
