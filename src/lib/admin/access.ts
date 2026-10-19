import { getSql, type Sql } from '../db';
import { getMode } from '../mode';
import type { SessionUser } from './session';
import { isAdminUser } from './settings';

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
