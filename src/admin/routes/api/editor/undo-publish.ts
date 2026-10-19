import { assertPublisher, editorContext, undoPublish } from '../../../../lib/admin/editor';
import { json, readBody, route } from '../../../../lib/admin/http';

export const prerender = false;

/** `{ commit }`: puts the files of that publish (Publish returned its id) back, if nothing on GitHub touched them since. */
export const POST = route(async (ctx, store, user) => {
  assertPublisher(user);
  const { commit } = await readBody<{ commit?: unknown }>(ctx);
  return json(await undoPublish(await editorContext(store, user), commit));
});
