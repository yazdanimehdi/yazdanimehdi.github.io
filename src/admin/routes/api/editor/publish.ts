import { assertPublisher, editorContext, publish } from '../../../../lib/admin/editor';
import { json, readBody, route } from '../../../../lib/admin/http';

export const prerender = false;

/** `{ message? }`: commits the sandbox's changes so the live site redeploys (Postgres mode: content goes live at once). */
export const POST = route(async (ctx, store, user) => {
  assertPublisher(user);
  const { message } = await readBody<{ message?: unknown }>(ctx);
  return json(await publish(await editorContext(store, user), message));
});
