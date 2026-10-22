// Chat in the request: one AI call over the paper's (or notebook's) passages, the owner's profile and the earlier
// turns. It counts against the reading room's daily cap; a failed turn stores nothing and is just asked again.
import { generateText, readAiConfig } from '../admin/ai';
import { HttpError } from '../admin/http';
import type { PostgresStore } from '../admin/postgres-store';
import type { Sql } from '../db';
import { errorText } from '../../workflows/runs';
import { allowedCites, loadGrounding } from './ground';
import { addChat, getNotebook, listChat, missingAiKey, searchPassages, useAiCall } from './room-db';
import { CONTEXT_CHARS, HISTORY, chatPrompt, orQuery, parseAnswer, pickPassages } from './room-prompts';
import type { ChatMessage, Target } from './types';

export async function askChat(
  sql: Sql,
  store: PostgresStore,
  target: Target,
  question: string,
  opts: { now?: Date; budget?: number } = {},
): Promise<{ question: ChatMessage; answer: ChatMessage }> {
  const q = question.trim();
  if (!q || q.length > 2000) throw new HttpError(400, 'Ask a question of up to 2,000 characters');
  const ids = 'paper' in target ? [target.paper] : (await getNotebook(sql, target.notebook))?.paperIds;
  if (!ids) throw new HttpError(404, 'Not found');
  if (!ids.length) throw new HttpError(409, 'This notebook has no papers yet.');
  const g = await loadGrounding(sql, store, ids);
  if (!g.papers.length) throw new HttpError(404, 'Not found');
  if (g.unread.length)
    throw new HttpError(
      409,
      `${'paper' in target ? 'The' : 'A'} paper’s text is still being fetched. Try again in a minute.`,
    );

  const ai = await readAiConfig(store);
  const missing = await missingAiKey(sql, ai);
  if (missing) throw new HttpError(400, missing);
  const cap = g.prefs.roomAiCalls;
  if (!(await useAiCall(sql, (opts.now ?? new Date()).toISOString().slice(0, 10), cap)))
    throw new HttpError(
      429,
      `Today’s ${cap} reading-room AI calls are used up. Chat is back tomorrow; the rest of the page still works.`,
    );

  // ponytail: searches even when everything fits (pickPassages then ignores the hits); one cheap indexed query.
  const query = orQuery(q);
  const hits = query ? await searchPassages(sql, ids, query, 200) : null;
  const papers = pickPassages(g.papers, hits, opts.budget ?? CONTEXT_CHARS);
  const history = await listChat(sql, target, HISTORY);
  let reply: string;
  try {
    reply = await generateText(store, ai, chatPrompt(papers, g.profile, history, q, g.scan));
  } catch (e) {
    throw new HttpError(502, errorText(e));
  }
  const answer = parseAnswer(reply, allowedCites(papers, g.scan));
  if (!/[\p{L}\p{N}]/u.test(answer.body))
    throw new HttpError(502, 'The answer cited only passages that aren’t in the paper, so it was dropped. Ask again.');
  return sql.begin(async (tx) => ({
    question: await addChat(tx, target, { role: 'user', body: q, cites: [] }),
    answer: await addChat(tx, target, { role: 'assistant', ...answer }),
  }));
}
