import { isDeepStrictEqual } from 'node:util';
import { entryChange, listEntries, readEntry } from '../../../../lib/admin/content';
import { HttpError, commitChanges, json, readBody, route } from '../../../../lib/admin/http';
import { COMPLETABLE, proposeBatch, proposeFor, type Completable } from '../../../../lib/admin/paper-complete';
import { paperLookupFor, parseState } from '../../../../lib/admin/papers';
import { SCHOLAR_JSON, collectionPath } from '../../../../lib/admin/paths';
import type { Change } from '../../../../lib/admin/store';

export const prerender = false;

const BATCH = 10;
const int = (v: string | null) => Number.parseInt(v ?? '', 10);

/** "Complete papers", read-only: proposals for up to 10 publications from `offset` (by slug); `offset` in the answer is where the next batch starts. */
export const GET = route(async (ctx, store) => {
  const from = Math.max(0, int(ctx.url.searchParams.get('offset')) || 0);
  const limit = Math.min(BATCH, Math.max(1, int(ctx.url.searchParams.get('limit')) || BATCH));
  const [entries, stateFile, look] = await Promise.all([
    listEntries(store, 'publications'),
    store.read(SCHOLAR_JSON),
    paperLookupFor(store),
  ]);
  // .mdx entries are never written, so there is nothing to propose for them.
  const pubs = entries.filter((e) => !e.readonly).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const declined = parseState(stateFile?.content).declined ?? {};
  const proposals = await proposeBatch(pubs.slice(from, from + limit), look, declined);
  return json({ total: pubs.length, offset: from + proposals.length, proposals });
});

const isField = (f: unknown): f is Completable => (COMPLETABLE as readonly unknown[]).includes(f);

/** "Apply selected" for one paper: re-proposes from fresh lookups, writes the approved fields and records the declined ones in one commit. */
export const POST = route(async (ctx, store) => {
  const { slug, apply, decline } = await readBody<{ slug?: unknown; apply?: unknown; decline?: unknown }>(ctx);
  if (
    typeof slug !== 'string' ||
    !Array.isArray(apply) ||
    !apply.every(isField) ||
    !Array.isArray(decline) ||
    !decline.every((d) => d && typeof d === 'object' && isField(d.field))
  )
    throw new HttpError(400, '`slug`, `apply` (field names) and `decline` ({ field, value }) are required');
  const declines = decline as { field: Completable; value: unknown }[];
  const named = [...apply, ...declines.map((d) => d.field)];
  if (!named.length) throw new HttpError(400, 'Nothing to apply or decline');
  if (new Set(named).size !== named.length) throw new HttpError(400, 'A field is named twice');

  const [entry, stateFile, look] = await Promise.all([
    readEntry(store, 'publications', slug),
    store.read(SCHOLAR_JSON),
    paperLookupFor(store),
  ]);
  if (!entry || entry.readonly) throw new HttpError(404, `No publication ${slug}`);
  const state = parseState(stateFile?.content);
  const proposal = await proposeFor(slug, entry.data, look, state.declined?.[slug]);
  if (proposal.error) throw new HttpError(502, proposal.error);

  // Only values recomputed here are written or declined; the client's copy must still match them.
  const offered = new Map(proposal.changes.map((c) => [c.field, c]));
  const stale = () => new HttpError(409, 'This paper changed; reload the review');
  if (!apply.every((f) => offered.has(f))) throw stale();
  if (!declines.every((d) => offered.has(d.field) && isDeepStrictEqual(d.value, offered.get(d.field)!.to)))
    throw stale();

  const changes: Change[] = [];
  const base: Record<string, string | null> = {};
  if (apply.length) {
    const picked = Object.fromEntries(apply.map((f) => [f, offered.get(f)!.to]));
    changes.push(entryChange('publications', slug, { ...entry.data, ...picked }, entry.body));
    base[collectionPath('publications', slug)] = entry.version;
  }
  if (declines.length) {
    const mine = { ...state.declined?.[slug] };
    for (const d of declines) mine[d.field] = JSON.stringify(offered.get(d.field)!.to);
    const next = { ...state, declined: { ...state.declined, [slug]: mine } };
    changes.push({ path: SCHOLAR_JSON, content: `${JSON.stringify(next, null, 2)}\n` });
    base[SCHOLAR_JSON] = stateFile?.version ?? null;
  }
  await commitChanges(store, changes, `Complete publication ${slug}`, base);
  return json({ ...proposal, changes: proposal.changes.filter((c) => !named.includes(c.field)) });
});
