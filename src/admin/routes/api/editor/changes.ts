import { discardChanges, editorContext } from '../../../../lib/admin/editor';
import { json, route } from '../../../../lib/admin/http';

export const prerender = false;

/** Discard: drops every change in the sandbox and updates it to the live site. */
export const DELETE = route(async (_ctx, store, user) => json(await discardChanges(await editorContext(store, user))));
