import { HttpError, commitChanges, json, postgresOnly, readBody, route } from '../../../../../lib/admin/http';

import { assertPublisher } from '../../../../../lib/admin/editor';
import { isThemePath } from '../../../../../lib/admin/paths';

export const prerender = false;

/** Restores a revision as a new save on top of `version` (the document's current version; null if it was deleted). */
export const POST = route(async (ctx, store, user) => {
  const pg = postgresOnly(store);
  const { version = null } = await readBody<{ version?: unknown }>(ctx);
  if (version !== null && typeof version !== 'string') throw new HttpError(400, '`version` must be a string or null');
  const rev = await pg.revision(String(ctx.params.id));
  if (!rev) throw new HttpError(404, 'No such revision');
  if (rev.content === null) throw new HttpError(400, 'That revision is a deletion; restore an earlier one');
  // Theme templates run inside the renderer: restoring one is as privileged as uploading it.
  if (isThemePath(rev.path)) assertPublisher(user);
  return json(
    await commitChanges(pg, [{ path: rev.path, content: rev.content }], `Restore ${rev.path}`, {
      [rev.path]: version,
    }),
  );
});
