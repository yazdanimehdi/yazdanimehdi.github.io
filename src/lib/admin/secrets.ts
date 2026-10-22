import { getSql, type Sql } from '../db';
import { HttpError } from './http';
import { PostgresStore } from './postgres-store';
import { sessionKey, sessionSecret } from './session';
import type { ContentStore } from './store';

/** Every provider key the admin knows: the only list of key names. Each is also read from the env var of that name. */
export const SECRETS = {
  OPENAI_API_KEY: 'OpenAI',
  ANTHROPIC_API_KEY: 'Anthropic',
  GEMINI_API_KEY: 'Google Gemini',
  HIGGSFIELD_API_KEY: 'Higgsfield API key',
  HIGGSFIELD_API_SECRET: 'Higgsfield API secret',
  SERPAPI_KEY: 'SerpApi (Google Scholar)',
  ADZUNA_APP_ID: 'Adzuna app id',
  ADZUNA_APP_KEY: 'Adzuna app key',
  USAJOBS_API_KEY: 'USAJobs API key',
} as const;
export type SecretName = keyof typeof SECRETS;

/** Job-source keys: listed and set only through the owner-only career route, never `ai/keys`. */
export const CAREER_SECRETS: SecretName[] = ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'USAJOBS_API_KEY'];

export interface SecretStatus {
  name: SecretName;
  label: string;
  source: 'admin' | 'env' | null;
  last4?: string;
  /** A stored value that no longer decrypts (SESSION_SECRET changed): it reads as unset. */
  undecryptable?: true;
}

// ponytail: rotating SESSION_SECRET orphans every stored key; the admin asks for them again.
const SALT = 'scholaros-secrets';

export function assertSecretName(name: unknown): SecretName {
  if (typeof name !== 'string' || !Object.hasOwn(SECRETS, name)) {
    throw new HttpError(400, `Unknown key "${String(name)}"`);
  }
  return name as SecretName;
}

/** `base64url(iv ‖ AES-GCM(value))`. */
export async function sealSecret(value: string, secret = sessionSecret()): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sessionKey(secret, SALT);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)),
  );
  return Buffer.concat([iv, sealed]).toString('base64url');
}

/** The plaintext, or null when the value was sealed under another SESSION_SECRET or is malformed. */
export async function openSecret(sealed: string, secret = sessionSecret()): Promise<string | null> {
  const key = await sessionKey(secret, SALT);
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** The database holding admin-typed keys: Postgres mode only; git and memory stores read env vars alone. */
export const secretsDb = (store: ContentStore): Sql | null => (store instanceof PostgresStore ? getSql() : null);

/** Stored rows by name; a database that hasn't run migration 003 has none. */
async function storedRows(sql: Sql | null): Promise<Map<string, string>> {
  if (!sql) return new Map();
  try {
    return new Map(
      (await sql<{ name: string; value: string }>`select name, value from secrets`).map((r) => [r.name, r.value]),
    );
  } catch (e) {
    if ((e as { code?: unknown }).code === '42P01') return new Map();
    throw e;
  }
}

/** The admin-typed value, else the env var, else undefined. */
export async function getSecret(sql: Sql | null, name: SecretName): Promise<string | undefined> {
  const sealed = (await storedRows(sql)).get(name);
  return (sealed && (await openSecret(sealed))) || process.env[name] || undefined;
}

export const missingKey = (name: SecretName) =>
  new HttpError(400, `${name} is not set: add it on the Integrations screen or as an environment variable`);

/** Like getSecret, but a missing key is a 400 that says where to set it. */
export async function requireSecret(sql: Sql | null, name: SecretName): Promise<string> {
  const value = await getSecret(sql, name);
  if (!value) throw missingKey(name);
  return value;
}

/** Where each key comes from. Never includes a value beyond its last four characters. */
export async function listSecrets(sql: Sql | null, names?: SecretName[]): Promise<SecretStatus[]> {
  const rows = await storedRows(sql);
  return Promise.all(
    (names ?? (Object.keys(SECRETS) as SecretName[])).map(async (name) => {
      const sealed = rows.get(name);
      const value = sealed ? await openSecret(sealed) : null;
      const base = { name, label: SECRETS[name] };
      if (value) return { ...base, source: 'admin' as const, last4: value.slice(-4) };
      return {
        ...base,
        source: process.env[name] ? ('env' as const) : null,
        ...(sealed ? { undecryptable: true as const } : {}),
      };
    }),
  );
}

/** Stores (sealed) or, for null or '', deletes an admin-typed key. */
export async function setSecret(sql: Sql, name: SecretName, value: string | null, by: string): Promise<void> {
  const plain = value?.trim() ?? '';
  try {
    if (!plain) await sql`delete from secrets where name = ${name}`;
    else
      await sql`
        insert into secrets (name, value, updated_by) values (${name}, ${await sealSecret(plain)}, ${by})
        on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
  } catch (e) {
    if ((e as { code?: unknown }).code === '42P01') {
      throw new HttpError(503, 'Saving keys needs the database migration: run `pnpm db:migrate`');
    }
    throw e;
  }
}
