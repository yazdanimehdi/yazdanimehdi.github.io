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
  if (actor.provider === 'password' && actor.login === user)
    throw new HttpError(409, "You can't delete your own account");
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
): Promise<
  | { ok: true; account: { username: string; name: string; version: number } }
  | { ok: false; reason: 'wrong' | 'throttled' }
> {
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
