import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AiConfig } from '../../../../lib/ai/providers';
import { generateText, readAiConfig } from '../../../../lib/admin/ai';
import { entryChange, listEntries, readEntry } from '../../../../lib/admin/content';
import { HttpError, commitChanges, json, readBody, route } from '../../../../lib/admin/http';
import { MAX_UPLOAD } from '../../../../lib/admin/media';
import {
  COMPLETABLE,
  PdfBudgetSpent,
  fromPdf,
  isPdfField,
  pdfValue,
  proposeBatch,
  proposeFor,
  type Completable,
  type PaperProposal,
  type ReadPdf,
} from '../../../../lib/admin/paper-complete';
import type { PaperRecord } from '../../../../lib/admin/paper-sources';
import { paperLookupFor, parseState } from '../../../../lib/admin/papers';
import { SCHOLAR_JSON, collectionPath } from '../../../../lib/admin/paths';
import type { Change, ContentStore } from '../../../../lib/admin/store';

export const prerender = false;

const BATCH = 10;
const PDF_READS = 5;
const int = (v: string | null) => Number.parseInt(v ?? '', 10);

// The model's reading of each PDF, by content hash, so reopening the review doesn't ask the AI again.
// ponytail: per instance; persisting readings would make GET write (a commit in git mode).
const readings = new Map<string, PaperRecord | null>();

/** Reads the owner's own uploaded PDFs (the store refuses any other URL) with the configured model, `budget` AI calls at most. */
function pdfReader(store: ContentStore, budget: number): ReadPdf {
  let config: Promise<AiConfig> | undefined;
  return async (url) => {
    const bytes = await store.readPdf(url);
    if (!bytes) return null;
    if (bytes.length > MAX_UPLOAD) throw new Error('it is over 4 MB');
    const key = createHash('sha256').update(bytes).digest('hex');
    if (readings.has(key)) return readings.get(key) ?? null;
    if (budget <= 0) throw new PdfBudgetSpent();
    budget--;
    config ??= readAiConfig(store);
    const ai = await config;
    const record = await fromPdf(bytes, (input) => generateText(store, ai, input));
    if (readings.size >= 100) readings.clear();
    readings.set(key, record);
    return record;
  };
}

/** The owner's uploaded PDF stays: a source's PDF link is never offered in its place. */
async function keepOwnPdf(
  store: ContentStore,
  data: Record<string, unknown>,
  p: PaperProposal,
): Promise<PaperProposal> {
  const pdf = typeof data.pdf === 'string' ? data.pdf.trim() : '';
  if (!pdf || !p.changes.some((c) => c.field === 'pdf') || !(await store.isOwnPdf(pdf))) return p;
  return { ...p, changes: p.changes.filter((c) => c.field !== 'pdf') };
}

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
  const batch = pubs.slice(from, from + limit);
  const proposals = await proposeBatch(batch, look, declined, pdfReader(store, PDF_READS));
  return json({
    total: pubs.length,
    offset: from + proposals.length,
    proposals: await Promise.all(proposals.map((p, i) => keepOwnPdf(store, batch[i].data, p))),
  });
});

const isField = (f: unknown): f is Completable => (COMPLETABLE as readonly unknown[]).includes(f);
const items = (v: unknown): v is { field: Completable; value: unknown; from?: unknown }[] =>
  Array.isArray(v) && v.every((d) => d && typeof d === 'object' && isField(d.field));
const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
/** Deep-equal, with every empty value (missing, null, '', []) alike: JSON drops a `from` that was undefined. */
const same = (a: unknown, b: unknown) => (blank(a) && blank(b)) || isDeepStrictEqual(a, b);

/**
 * "Apply selected" for one paper: re-proposes from fresh lookups, writes the approved fields and records the declined
 * ones in one commit. No AI call: a value read from the paper's own PDF (title, authors, abstract, year) is taken as
 * the owner reviewed it, cleaned as a reading is, since the owner may edit those fields anyway.
 */
export const POST = route(async (ctx, store) => {
  const { slug, apply, decline } = await readBody<{ slug?: unknown; apply?: unknown; decline?: unknown }>(ctx);
  if (typeof slug !== 'string' || !items(apply) || !items(decline))
    throw new HttpError(400, '`slug`, `apply` ({ field, value, from }) and `decline` ({ field, value }) are required');
  const named = [...apply, ...decline].map((d) => d.field);
  if (!named.length) throw new HttpError(400, 'Nothing to apply or decline');
  if (new Set(named).size !== named.length) throw new HttpError(400, 'A field is named twice');

  const [entry, stateFile, look] = await Promise.all([
    readEntry(store, 'publications', slug),
    store.read(SCHOLAR_JSON),
    paperLookupFor(store),
  ]);
  if (!entry || entry.readonly) throw new HttpError(404, `No publication ${slug}`);
  const state = parseState(stateFile?.content);
  const proposal = await keepOwnPdf(
    store,
    entry.data,
    await proposeFor(slug, entry.data, look, state.declined?.[slug]),
  );
  if (proposal.error) throw new HttpError(502, proposal.error);

  // A source's value is written or declined only when recomputed here exactly as the owner reviewed it; a PDF field
  // only on a paper whose pdf is the site's own. An apply also needs the stored value it replaces unchanged.
  const offered = new Map(proposal.changes.map((c) => [c.field, c]));
  const ownPdf = typeof entry.data.pdf === 'string' && (await store.isOwnPdf(entry.data.pdf.trim()));
  const value = (d: { field: Completable; value: unknown }) => {
    const source = offered.get(d.field);
    if (source && isDeepStrictEqual(d.value, source.to)) return source.to;
    return ownPdf && isPdfField(d.field) ? pdfValue(d.field, d.value) : undefined;
  };
  const values = new Map([...apply, ...decline].map((d) => [d.field, value(d)]));
  if (!apply.every((d) => same(d.from, entry.data[d.field])) || [...values.values()].some((v) => v === undefined))
    throw new HttpError(409, 'This paper changed; reload the review');

  const changes: Change[] = [];
  const base: Record<string, string | null> = {};
  if (apply.length) {
    const picked = Object.fromEntries(apply.map((d) => [d.field, values.get(d.field)]));
    changes.push(entryChange('publications', slug, { ...entry.data, ...picked }, entry.body));
    base[collectionPath('publications', slug)] = entry.version;
  }
  if (decline.length) {
    const mine = { ...state.declined?.[slug] };
    for (const d of decline) mine[d.field] = JSON.stringify(values.get(d.field));
    const next = { ...state, declined: { ...state.declined, [slug]: mine } };
    changes.push({ path: SCHOLAR_JSON, content: `${JSON.stringify(next, null, 2)}\n` });
    base[SCHOLAR_JSON] = stateFile?.version ?? null;
  }
  await commitChanges(store, changes, `Complete publication ${slug}`, base);
  return json({ ...proposal, changes: proposal.changes.filter((c) => !named.includes(c.field)) });
});
