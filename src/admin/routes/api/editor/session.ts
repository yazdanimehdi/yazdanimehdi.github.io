import { editorContext, editorStatus, editorTarget, endSession, startSession } from '../../../../lib/admin/editor';
import { json, route } from '../../../../lib/admin/http';

export const prerender = false;

/** The session, its latest run, the preview URL and the changes; or why the editor can't run here. */
export const GET = route(async (_ctx, store, user) => json(await editorStatus(store, user)));

/** Start: resumes the site's sandbox (or sets it up on first use) and its preview. */
export const POST = route(async (_ctx, store, user) => json(await startSession(await editorContext(store, user))));

/** End: stops the sandbox; its files stay for the next Start. */
export const DELETE = route(async () => json(await endSession(editorTarget())));
