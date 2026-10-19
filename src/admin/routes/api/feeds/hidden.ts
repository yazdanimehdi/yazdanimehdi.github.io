import { configChange, readConfig } from '../../../../lib/admin/content';
import { HttpError, commitChanges, json, readBody, route } from '../../../../lib/admin/http';
import { FEEDS_JSON } from '../../../../lib/admin/paths';

export const prerender = false;

/** The Posts screen's "Imported" list: every feed item and which ones are hidden. */
export const GET = route(async (_ctx, store) => {
  const [config, file] = await Promise.all([readConfig(store, 'feeds'), store.read(FEEDS_JSON)]);
  let items: unknown;
  try {
    items = file ? JSON.parse(file.content) : [];
  } catch {
    return json({
      items: [],
      hidden: [],
      error: `${FEEDS_JSON} is not valid JSON. "Sync all feeds" on the Dashboard rewrites it.`,
    });
  }
  return json({
    items: Array.isArray(items) ? items : [],
    hidden: Array.isArray(config.data.hidden) ? config.data.hidden : [],
  });
});

/** Hide or unhide one feed item on the public site (`hidden:` in config/feeds.yml). */
export const PUT = route(async (ctx, store) => {
  const { id, hidden } = await readBody<{ id?: unknown; hidden?: unknown }>(ctx);
  if (typeof id !== 'string' || !id || id.length > 200 || typeof hidden !== 'boolean') {
    throw new HttpError(400, '`id` (string) and `hidden` (boolean) are required');
  }
  const current = await readConfig(store, 'feeds');
  const ids = new Set(Array.isArray(current.data.hidden) ? (current.data.hidden as string[]) : []);
  if (hidden) ids.add(id);
  else ids.delete(id);
  const change = configChange('feeds', current.source, { ...current.data, hidden: [...ids] });
  return json(
    await commitChanges(store, [change], `${hidden ? 'Hide' : 'Unhide'} feed item ${id}`, {
      [change.path]: current.version,
    }),
  );
});
