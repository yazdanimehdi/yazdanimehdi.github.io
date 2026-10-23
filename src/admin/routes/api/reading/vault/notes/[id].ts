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
  setNotePublic,
  withTitles,
} from '../../../../../../lib/reading/vault-db';
import { noteTitle } from '../../../../../../lib/reading/vault-links';
import { generatedMarkdown } from '../../../../../../lib/reading/vault-markdown';
import { listSuggestions } from '../../../../../../lib/reading/vault-suggest';
import { afterVaultWrite, noteVisibility } from '../../../../../../lib/reading/visibility';

export const prerender = false;

const CHAT_REFUSED = "Chat notes can't be made public: they are mostly AI text.";

const Patch = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(MAX_BODY).optional(),
  public: z.boolean().optional(),
});

/**
 * `{ note, generated, backlinks, suggestions, visibility }`: generated is the Markdown the vault writes above the
 * owner's.
 */
export const GET = careerRoute(async (ctx) => {
  const sql = getSql();
  const id = idParam(ctx.params.id);
  const note = await getNote(sql, id);
  if (!note) throw new HttpError(404, 'Not found');
  const [ctxs, links, suggestions, visibility] = await Promise.all([
    noteContexts(sql, [note]),
    backlinks(sql, id),
    listSuggestions(sql, id),
    noteVisibility(sql, note),
  ]);
  return json({ note, generated: generatedMarkdown(note, ctxs.get(id)!), backlinks: links, suggestions, visibility });
});

/**
 * `{ title?, body?, public? }` → `{ note, visibility, publishWarning? }`: a rename rewrites the links to the note, the
 * given body's own links included; a taken title, or a rewrite past MAX_BODY, changes nothing. Bodies are written
 * under the title lock, so a save waits for a rename or an accept rewriting this note rather than being overwritten
 * by it.
 */
export const PATCH = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  const { title, body, public: on } = Patch.parse(await readBody(ctx));
  const sql = getSql();
  // Refused before any write, so a body sent with it isn't saved either.
  if (on && (await getNote(sql, id))?.kind === 'chat') throw new HttpError(400, CHAT_REFUSED);
  if (title !== undefined) {
    const renamed = await renameNote(sql, id, title, body);
    if (renamed === 'taken') throw new HttpError(409, `A note called “${noteTitle(title)}” already exists`);
    if (!renamed) throw new HttpError(404, 'Not found');
  } else if (body !== undefined && !(await withTitles(sql, (tx) => setBody(tx, id, body))))
    throw new HttpError(404, 'Not found');
  const toggled = on === undefined ? undefined : await setNotePublic(sql, id, on);
  if (toggled === 'chat') throw new HttpError(400, CHAT_REFUSED);
  const warning = await afterVaultWrite(sql);
  const note = await getNote(sql, id);
  if (!note) throw new HttpError(404, 'Not found');
  return json({ note, visibility: await noteVisibility(sql, note), ...warning });
});

/** 204, or `{ publishWarning }` when the public copies couldn't be updated. */
export const DELETE = careerRoute(async (ctx) => {
  const sql = getSql();
  if (!(await deleteNote(sql, idParam(ctx.params.id)))) throw new HttpError(404, 'Not found');
  const warning = await afterVaultWrite(sql);
  return warning.publishWarning ? json(warning) : new Response(null, { status: 204 });
});
