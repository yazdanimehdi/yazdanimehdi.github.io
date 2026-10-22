import { z } from 'astro/zod';
import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { getPapers, readReading } from '../../../../../lib/reading/db';
import { addPaper, fetchMissingTexts, idParam, shownOutputs, useToday } from '../../../../../lib/reading/library';
import {
  deleteNotebook,
  getNote,
  getNotebook,
  getPassages,
  listHighlights,
  NOTEBOOK_MAX,
  readText,
  updateNotebook,
} from '../../../../../lib/reading/room-db';
import { parseReadingPrefs } from '../../../../../lib/reading/settings';
import type { Passage, TextState } from '../../../../../lib/reading/types';

export const prerender = false;

const FULL = 'A notebook holds up to 20 papers';
const Id = z.number().int().min(1).max(999_999_999);
const Patch = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  /** A paper id, or an arXiv id or DOI to add to the library first. */
  add: z.union([Id, z.string().max(300)]).optional(),
  remove: Id.optional(),
});

/** The reading room's data for a notebook. A paper whose text fetch failed is fetched again, unless an output's run is on it. */
export const GET = careerRoute(async (ctx) => {
  const sql = getSql();
  const id = idParam(ctx.params.id);
  const target = { notebook: id };
  const notebook = await getNotebook(sql, id);
  if (!notebook) throw new HttpError(404, 'Not found');
  const ids = notebook.paperIds;
  const [papers, textList, passageList, outputs, highlights, note, reading] = await Promise.all([
    getPapers(sql, ids),
    Promise.all(ids.map((p) => readText(sql, p))),
    getPassages(sql, ids),
    shownOutputs(sql, target),
    listHighlights(sql, ids),
    getNote(sql, target),
    readReading(sql),
  ]);
  const texts: Record<number, TextState> = {};
  const passages: Record<number, Passage[]> = {};
  ids.forEach((p, i) => {
    const { source, error, note: why, pages } = textList[i];
    texts[p] = { source, error, note: why, pages };
    passages[p] = [];
  });
  for (const { paperId, ...p } of passageList) passages[paperId].push(p);
  if (textList.some((t) => t.error) && !Object.values(outputs).some((o) => o.status === 'running'))
    await fetchMissingTexts(sql, target, ids);
  return json({
    notebook: { id: notebook.id, title: notebook.title },
    papers,
    texts,
    passages,
    outputs,
    highlights,
    note,
    use: await useToday(sql, parseReadingPrefs(reading.prefs)),
  });
});

/** `{ title?, add?, remove? }` → `{ ok: true }`; an added paper's text is fetched. */
export const PATCH = careerRoute(async (ctx, store) => {
  const id = idParam(ctx.params.id);
  const patch = Patch.parse(await readBody(ctx));
  const sql = getSql();
  let add: number | undefined;
  if (typeof patch.add === 'string') {
    // Before the lookup and the library save, which a missing or full notebook would waste.
    const notebook = await getNotebook(sql, id);
    if (!notebook) throw new HttpError(404, 'Not found');
    if (notebook.paperIds.length >= NOTEBOOK_MAX) throw new HttpError(409, FULL);
    add = (await addPaper(sql, store, patch.add)).id;
  } else if (patch.add !== undefined) {
    if (!(await getPapers(sql, [patch.add])).length) throw new HttpError(404, 'Not found');
    add = patch.add;
  }
  const done = await updateNotebook(sql, id, { title: patch.title, add, remove: patch.remove });
  if (!done) throw new HttpError(404, 'Not found');
  if (done === 'full') throw new HttpError(409, FULL);
  if (add !== undefined) await fetchMissingTexts(sql, { paper: add }, [add]);
  return json({ ok: true });
});

export const DELETE = careerRoute(async (ctx) => {
  if (!(await deleteNotebook(getSql(), idParam(ctx.params.id)))) throw new HttpError(404, 'Not found');
  return new Response(null, { status: 204 });
});
