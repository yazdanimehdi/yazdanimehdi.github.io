import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { HttpError } from './http';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { ...opts, maxmem: 64 * 1024 * 1024 }, (e, key) =>
      e ? reject(e) : resolve(key),
    ),
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
