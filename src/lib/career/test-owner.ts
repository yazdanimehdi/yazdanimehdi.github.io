import { adminLogin, adminSettings } from '../admin/settings';

/** The session user for the configured job-search owner, whether site.yml names a GitHub login or a `password:` account. */
export function ownerUser() {
  const entry = adminSettings().owner.trim();
  const password = /^password:/i.test(entry);
  const login = password ? entry.slice('password:'.length).trim() : adminLogin(entry);
  return { login, name: login, avatar: '', provider: password ? ('password' as const) : ('github' as const) };
}

/** A signed-in admin of the same kind who is not the owner. */
export function nonOwnerUser() {
  const o = ownerUser();
  return { ...o, login: `${o.login}-other`, name: `${o.login}-other` };
}
