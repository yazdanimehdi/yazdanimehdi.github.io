import { editorContext, startRun } from '../../../../lib/admin/editor';
import { json, readBody, route } from '../../../../lib/admin/http';

export const prerender = false;

/** `{ prompt }`: starts the coding agent in the sandbox and returns the run at once; the status poll follows it. */
export const POST = route(async (ctx, store, user) => {
  const { prompt } = await readBody<{ prompt?: unknown }>(ctx);
  return json(await startRun(await editorContext(store, user), prompt));
});
