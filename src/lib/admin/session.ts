export interface SessionUser {
  login: string;
  name: string;
  avatar: string;
  /** How the session was opened; cookies from before password sign-in existed have none and mean GitHub. */
  provider: 'github' | 'password';
  /** Password sessions: the account's session_version at sign-in (a reset or password change ends the session). */
  version?: number;
}

export const SESSION_COOKIE = 'scholaros_session';
export const OAUTH_STATE_COOKIE = 'scholaros_oauth_state';
/** Seconds. Sessions are never refreshed: sign in again after a week. */
export const SESSION_TTL = 7 * 24 * 60 * 60;
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_TTL,
} as const;

const encoder = new TextEncoder();

/** An AES-GCM key derived from SESSION_SECRET; each use (sessions, stored secrets) has its own salt. */
export async function sessionKey(secret: string, salt = 'scholaros-session'): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(salt), info: encoder.encode('v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** `base64url(iv ‖ AES-GCM(JSON { login, name, avatar, provider, version?, exp }))`. */
export async function sealSession(user: SessionUser, secret: string, now = Date.now()): Promise<string> {
  const key = await sessionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const exp = Math.floor(now / 1000) + SESSION_TTL;
  const provider = user.provider ?? 'github';
  const payload = encoder.encode(
    JSON.stringify({
      login: user.login,
      name: user.name,
      avatar: user.avatar,
      provider,
      ...(provider === 'password' ? { version: user.version } : {}),
      exp,
    }),
  );
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload));
  return Buffer.concat([iv, sealed]).toString('base64url');
}

/** The session's user, or null when the token is tampered with, from another key, malformed or expired. */
export async function openSession(token: string, secret: string, now = Date.now()): Promise<SessionUser | null> {
  const key = await sessionKey(secret);
  try {
    const raw = Buffer.from(token, 'base64url');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
    const p = JSON.parse(new TextDecoder().decode(plain)) as {
      login: unknown;
      name: unknown;
      avatar: unknown;
      provider: unknown;
      version: unknown;
      exp: unknown;
    };
    if (typeof p.exp !== 'number' || p.exp * 1000 <= now || typeof p.login !== 'string') return null;
    const provider = p.provider === 'password' ? 'password' : 'github';
    if (provider === 'password' && (typeof p.version !== 'number' || !Number.isInteger(p.version))) return null;
    return {
      login: p.login,
      name: typeof p.name === 'string' ? p.name : p.login,
      avatar: typeof p.avatar === 'string' ? p.avatar : '',
      provider,
      ...(provider === 'password' ? { version: p.version as number } : {}),
    };
  } catch {
    return null;
  }
}

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters');
  return secret;
}

export function oauthEnv(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set');
  return { clientId, clientSecret };
}
