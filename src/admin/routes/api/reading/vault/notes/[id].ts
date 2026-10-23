import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../../lib/admin/http';
import { careerRoute } from '../../../../../../lib/career/route';
import { getSql } from '../../../../../../lib/db';
import { idParam } from '../../../../../../lib/reading/library';
import {
  MAX_BODY,
  backlinks,
  deleteNote,
  getNote,
  noteContexts,
  renameNote,
  setBody,
  withTitles,
} from '../../../../../../lib/reading/vault-db';
import { noteTitle } from '../../../../../../lib/reading/vault-links';
import { generatedMarkdown } from '../../../../../../lib/reading/vault-markdown';
import { listSuggestions } from '../../../../../../lib/reading/vault-suggest';

export const prerender = false;

const Patch = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(MAX_BODY).optional(),
});

/** `{ note, generated, backlinks, suggestions }`: generated is the Markdown the vault writes above the owner's. */
export const GET = careerRoute(async (ctx) => {
  const sql = getSql();
  const id = idParam(ctx.params.id);
  const note = await getNote(sql, id);
  if (!note) throw new HttpError(404, 'Not found');
  const [ctxs, links, suggestions] = await Promise.all([
    noteContexts(sql, [note]),
    backlinks(sql, id),
    listSuggestions(sql, id),
  ]);
  return json({ note, generated: generatedMarkdown(note, ctxs.get(id)!), backlinks: links, suggestions });
});

/**
 * `{ title?, body? }` → `{ note }`: a rename rewrites the links to the note, the given body's own links included; a
 * taken title, or a rewrite past MAX_BODY, changes nothing. Bodies are written under the title lock, so a save waits
 * for a rename or an accept rewriting this note rather than being overwritten by it.
 */
export const PATCH = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  const { title, body } = Patch.parse(await readBody(ctx));
  const sql = getSql();
  if (title !== undefined) {
    const renamed = await renameNote(sql, id, title, body);
    if (renamed === 'taken') throw new HttpError(409, `A note called “${noteTitle(title)}” already exists`);
    if (!renamed) throw new HttpError(404, 'Not found');
  } else if (body !== undefined && !(await withTitles(sql, (tx) => setBody(tx, id, body))))
    throw new HttpError(404, 'Not found');
  const note = await getNote(sql, id);
  if (!note) throw new HttpError(404, 'Not found');
  return json({ note });
});

export const DELETE = careerRoute(async (ctx) => {
  if (!(await deleteNote(getSql(), idParam(ctx.params.id)))) throw new HttpError(404, 'Not found');
  return new Response(null, { status: 204 });
});
