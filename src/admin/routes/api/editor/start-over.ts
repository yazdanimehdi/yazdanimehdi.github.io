import { editorContext, startOver } from '../../../../lib/admin/editor';
import { json, route } from '../../../../lib/admin/http';

export const prerender = false;

/** Start over: deletes the sandbox, unpublished changes included, and starts again from a fresh clone of the site. */
export const POST = route(async (_ctx, store, user) => json(await startOver(await editorContext(store, user))));
