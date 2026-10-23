// A blog draft from papers and notes, in the request: what it draws on (its papers and notes, the owner's past posts
// for voice), one AI call against the reading room's daily cap, and the post saved as an unpublished draft.
import { errorText } from '../../workflows/runs';
import { generateText, missingAiKey, readAiConfig } from '../admin/ai';
import { entryChange, listEntries, readEntry } from '../admin/content';
import { commitChanges, HttpError } from '../admin/http';
import type { PostgresStore } from '../admin/postgres-store';
import type { ContentStore } from '../admin/store';
import type { Sql } from '../db';
import { isPublished, suggestSlug, uniqueSlug } from '../utils';
import { DRAFT_MAX_PAPERS, type DraftQuote, draftPrompt, parseDraft } from './blog-prompts';
import { getPapers, type Row } from './db';
import { allowedCites, loadGrounding } from './ground';
import { getNotebook, useAiCall } from './room-db';
import { CONTEXT_CHARS, pickPassages } from './room-prompts';
import type { DraftFrom, VaultNote } from './types';
import { getNote, noteContexts, ownChatText } from './vault-db';
import { wikiLinks } from './vault-links';
import { generatedMarkdown } from './vault-markdown';

const notFound = () => new HttpError(404, 'Not found');

/** A note's papers: its paper, a chat's cited papers (else its chat's paper), or a free note's notebook and links. */
async function notePapers(sql: Sql, note: VaultNote): Promise<number[]> {
  if (note.paperId != null) return [note.paperId];
  if (note.chat) {
    if (note.chat.cites.length) return note.chat.cites.map((c) => c.paper);
    const [r] = await sql<Row>`select paper_id from reading_chats where id = ${note.chatId}::bigint`;
    return r?.paper_id != null ? [Number(r.paper_id)] : [];
  }
  const own = note.notebookId == null ? [] : ((await getNotebook(sql, note.notebookId))?.paperIds ?? []);
  const linked = await sql<Row>`
    select v.paper_id from unnest(${wikiLinks(note.body)}::text[]) with ordinality l(t, i)
    join vault_notes v on v.kind = 'paper' and lower(v.title) = lower(l.t)
    order by l.i`;
  return [...own, ...linked.map((r) => Number(r.paper_id))];
}

/** The papers and notes a draft from `from` draws on; a 404 or 409 with a sentence when it can't be drafted. */
export async function draftSources(sql: Sql, from: DraftFrom): Promise<{ paperIds: number[]; noteIds: number[] }> {
  let ids: number[];
  let noteIds: number[] = [];
  let note: VaultNote | null = null;
  if ('paper' in from) ids = [from.paper];
  else if ('papers' in from) {
    if (!from.papers.length) throw new HttpError(409, 'Pick at least one paper to draft from.');
    ids = from.papers;
  } else if ('notebook' in from) {
    const nb = await getNotebook(sql, from.notebook);
    if (!nb) throw notFound();
    if (!nb.paperIds.length) throw new HttpError(409, 'This notebook has no papers yet.');
    ids = nb.paperIds;
    noteIds = (await sql<Row>`select id from vault_notes where notebook_id = ${nb.id}`).map((r) => Number(r.id));
  } else {
    note = await getNote(sql, from.note);
    if (!note) throw notFound();
    noteIds = [note.id];
    ids = await notePapers(sql, note);
  }
  const unique = [...new Set(ids)];
  const paperIds = (await getPapers(sql, unique)).map((p) => p.id);
  if (('paper' in from || 'papers' in from) && paperIds.length < unique.length) throw notFound();
  // A chat note's saved answer is content, whatever its body.
  if (note && !paperIds.length && !note.body.trim() && !note.chat?.answer.trim())
    throw new HttpError(409, 'This note has no text and links no paper yet.');
  if (paperIds.length > DRAFT_MAX_PAPERS)
    throw new HttpError(
      409,
      `A post can draw on up to ${DRAFT_MAX_PAPERS} papers; this has ${paperIds.length}. Pick up to ` +
        `${DRAFT_MAX_PAPERS} in the Library.`,
    );
  return { paperIds, noteIds };
}

const NOTE_MAX = 4_000;
const NOTES_MAX = 24_000;
const QUOTE_MAX = 300;

/** The first `n` UTF-16 units, never ending on half a surrogate pair. */
function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  const last = s.charCodeAt(n - 1);
  return s.slice(0, last >= 0xd800 && last < 0xdc00 ? n - 1 : n);
}
/** Cuts each text to what is left of `n` chars, in turn. */
const budget = (n: number) => (t: string) => {
  const s = cut(t, Math.max(n, 0));
  n -= s.length;
  return s;
};

/**
 * The notes `noteIds`, then the paper notes of `paperIds`, then the chat notes on those papers (newest first), each
 * once, split three ways: `notes`, the owner's writing (bodies, highlight comments); `quotes`, the papers' lines the
 * owner highlighted (each cut to 300 chars); `aids`, the AI-made reading aids (summaries, findings, saved answers).
 * A note gives at most 4,000 chars in all, and all notes 24,000: the owner's writing first, then quotes, then aids.
 */
export async function draftNotes(
  sql: Sql,
  paperIds: number[],
  noteIds: number[],
): Promise<{ notes: string[]; aids: string[]; quotes: DraftQuote[] }> {
  const [byPaper, chats] = await Promise.all([
    sql<Row>`
      select id from vault_notes where paper_id = any(${paperIds}::bigint[])
      order by array_position(${paperIds}::bigint[], paper_id)`,
    // ponytail: the 50 newest saved answers; older ones would mostly fall past the 24,000-char cap anyway.
    sql<Row>`
      select id from vault_notes v
      where kind = 'chat' and (
        exists (
          select 1 from jsonb_array_elements(v.chat->'cites') c
          where (c->>'paper')::bigint = any(${paperIds}::bigint[]))
        or chat_id in (select id from reading_chats where paper_id = any(${paperIds}::bigint[])))
      order by created_at desc, id desc limit 50`,
  ]);
  const ids = [...new Set([...noteIds, ...[...byPaper, ...chats].map((r) => Number(r.id))])];
  const notes = (await Promise.all(ids.map((id) => getNote(sql, id)))).filter((n): n is VaultNote => n != null);
  const ctx = await noteContexts(sql, notes);
  const join = (...t: string[]) => t.filter((x) => x.trim()).join('\n\n');
  const parts = notes.map((n) => {
    const c = ctx.get(n.id)!;
    const take = budget(NOTE_MAX);
    const highlights = c.highlights ?? [];
    let own = '';
    let aid = '';
    if (n.kind === 'paper') {
      const comments = highlights
        .filter((h) => h.comment.trim())
        .map((h) => `- On a line I highlighted in the paper: ${h.comment.trim()}`)
        .join('\n');
      if (comments || n.body.trim()) own = join(`# ${n.title}`, comments, n.body.trim());
      if (c.summary) aid = generatedMarkdown(n, { ...c, highlights: [] });
    } else if (n.kind === 'chat') {
      const body = ownChatText(n.body).trim();
      if (body) own = join(`# ${n.title}`, body);
      if (n.chat?.answer.trim()) aid = generatedMarkdown(n, c);
    } else own = n.body.trim();
    own = take(own);
    const quotes = highlights.flatMap((h): DraftQuote[] => {
      const text = take(cut(h.quote.trim(), QUOTE_MAX));
      return text ? [{ paperId: n.paperId!, text }] : [];
    });
    return { own, quotes, aid: take(aid) };
  });
  const take = budget(NOTES_MAX);
  return {
    notes: parts.map((p) => take(p.own)).filter(Boolean),
    quotes: parts.flatMap((p) => p.quotes.map((q) => ({ ...q, text: take(q.text) }))).filter((q) => q.text),
    aids: parts.map((p) => take(p.aid)).filter(Boolean),
  };
}

/** The owner's 3 newest published posts, '# <title>\n\n<body>' cut to 2,000 chars; [] on any error. */
export async function voiceExamples(store: ContentStore, now = new Date()): Promise<string[]> {
  try {
    const time = (d: unknown) => new Date(d as string).getTime();
    const posts = (await listEntries(store, 'posts'))
      .filter((e) => isPublished({ data: e.data as { draft?: boolean; date: string } }, now))
      .sort((a, b) => time(b.data.date) - time(a.data.date) || a.slug.localeCompare(b.slug))
      .slice(0, 3);
    const entries = await Promise.all(posts.map((p) => readEntry(store, 'posts', p.slug)));
    return entries.flatMap((e, i) =>
      e ? [cut(`# ${String(e.data.title ?? posts[i].slug)}\n\n${e.body.trim()}`, 2000)] : [],
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[reading] voice', e);
    return [];
  }
}

/**
 * Drafts a post from `from` and saves it as an unpublished post. Nothing is spent before the sources, the key and the
 * daily cap are checked, and nothing is written unless the reply passes every check of parseDraft.
 */
export async function draftPost(
  sql: Sql,
  store: PostgresStore,
  from: DraftFrom,
  o: { now?: Date; budget?: number } = {},
): Promise<{ slug: string }> {
  const now = o.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const { paperIds, noteIds } = await draftSources(sql, from);
  // With no papers this still reads the prefs and the profile (readReading, readProfile + profileText).
  const g = await loadGrounding(sql, store, paperIds);
  if (g.unread.length)
    throw new HttpError(
      409,
      `${paperIds.length > 1 ? 'A' : 'The'} paper’s text is still being fetched. Try again in a minute.`,
    );
  const [{ notes, aids, quotes }, examples, meta] = await Promise.all([
    draftNotes(sql, paperIds, noteIds),
    voiceExamples(store, now),
    getPapers(sql, paperIds),
  ]);

  const ai = await readAiConfig(store);
  const missing = await missingAiKey(sql, ai);
  if (missing) throw new HttpError(400, missing);
  const cap = g.prefs.roomAiCalls;
  if (!(await useAiCall(sql, day, cap)))
    throw new HttpError(429, `Today’s ${cap} reading-room AI calls are used up. Drafting is back tomorrow.`);

  const papers = pickPassages(g.papers, null, o.budget ?? CONTEXT_CHARS);
  let reply: string;
  try {
    reply = await generateText(
      store,
      ai,
      draftPrompt({ papers, profile: g.profile, notes, aids, quotes, examples, scan: g.scan }),
    );
  } catch (e) {
    throw new HttpError(502, errorText(e));
  }
  let post: ReturnType<typeof parseDraft>;
  try {
    post = parseDraft(reply, {
      allowed: allowedCites(papers, g.scan),
      papers: meta,
      // What the prompt showed of the papers' words: the passages picked, and the highlighted lines.
      passages: [
        ...papers.flatMap((p) => p.passages.filter((q) => !/^h\d$/.test(q.kind)).map((q) => q.body)),
        ...quotes.map((q) => q.text),
      ],
    });
  } catch (e) {
    throw new HttpError(502, errorText(e));
  }

  // ponytail: a post created under this slug between the listing and the commit gets the store's 409 (ConflictError);
  // drafting again picks the next number.
  const taken = new Set((await listEntries(store, 'posts')).map((e) => e.slug));
  const slug = uniqueSlug(suggestSlug(post.title) || 'reading-notes', taken);
  const data = {
    title: post.title,
    subtitle: post.subtitle,
    excerpt: post.excerpt,
    tags: post.tags.length ? post.tags : undefined,
    date: day,
    draft: true,
  };
  const change = entryChange('posts', slug, data, post.body);
  await commitChanges(store, [change], `Draft post from the reading room: ${slug}`, { [change.path]: null });
  return { slug };
}
