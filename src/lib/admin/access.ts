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
