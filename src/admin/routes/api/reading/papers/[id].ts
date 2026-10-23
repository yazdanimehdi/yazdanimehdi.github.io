import { HttpError, json, readBody } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { getPapers, readReading, setPaperState } from '../../../../../lib/reading/db';
import { fetchMissingTexts, idParam, shownOutputs, useToday } from '../../../../../lib/reading/library';
import { getPassages, listHighlights, notebooksOf, readText } from '../../../../../lib/reading/room-db';
import { parseReadingPrefs } from '../../../../../lib/reading/settings';
import type { PaperState } from '../../../../../lib/reading/types';
import { ensurePaperNote, getNote, roomNote, withTitles } from '../../../../../lib/reading/vault-db';
import { highlightCounts, visibilityOf } from '../../../../../lib/reading/visibility';

export const prerender = false;

const STATES = new Set<string>(['new', 'saved', 'dismissed'] satisfies PaperState[]);

/**
 * The reading room's data for one paper. On opening (`?open=1`, not a poll), a text never fetched or whose fetch
 * failed is fetched, unless an output's run is on it.
 */
export const GET = careerRoute(async (ctx) => {
  const sql = getSql();
  const id = idParam(ctx.params.id);
  const target = { paper: id };
  const [[paper], t, passages, outputs, highlights, note, notebooks, reading] = await Promise.all([
    getPapers(sql, [id]),
    readText(sql, id),
    getPassages(sql, [id]),
    shownOutputs(sql, target),
    listHighlights(sql, [id]),
    roomNote(sql, target),
    notebooksOf(sql, id),
    readReading(sql),
  ]);
  if (!paper) throw new HttpError(404, 'Not found');
  if (ctx.url.searchParams.has('open') && !Object.values(outputs).some((o) => o.status === 'running'))
    await fetchMissingTexts(sql, target, [id]);
  return json({
    paper,
    text: { source: t.source, error: t.error, note: t.note, pages: t.pages },
    passages: passages.map(({ pid, kind, body }) => ({ pid, kind, body })),
    outputs,
    highlights,
    note: note.body,
    vaultNote: note.id,
    visibility: visibilityOf(note.id == null ? null : await getNote(sql, note.id), highlightCounts(highlights)),
    notebooks,
    use: await useToday(sql, parseReadingPrefs(reading.prefs)),
  });
});

/**
 * `{ state }`: save, dismiss or reset a paper → `{ state }`. Saving gives it a vault note, and starts fetching its text
 * when it has none.
 */
export const PATCH = careerRoute(async (ctx) => {
  const id = idParam(ctx.params.id);
  const { state } = await readBody<{ state?: unknown }>(ctx);
  if (typeof state !== 'string' || !STATES.has(state))
    throw new HttpError(400, '`state` must be new, saved or dismissed');
  const sql = getSql();
  const found = await withTitles(sql, async (tx) => {
    if (!(await setPaperState(tx, id, state as PaperState))) return false;
    if (state === 'saved') await ensurePaperNote(tx, id);
    return true;
  });
  if (!found) throw new HttpError(404, 'Not found');
  if (state === 'saved') await fetchMissingTexts(sql, { paper: id }, [id]);
  return json({ state });
});
