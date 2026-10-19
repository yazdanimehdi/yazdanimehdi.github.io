import { editorTarget, revertFile } from '../../../../lib/admin/editor';
import { json, readBody, route } from '../../../../lib/admin/http';

export const prerender = false;

/** `{ path }`: undoes the change to one file, e.g. a refused one, and keeps every other change. */
export const POST = route(async (ctx) => {
  const { path } = await readBody<{ path?: unknown }>(ctx);
  return json(await revertFile(editorTarget(), path));
});
