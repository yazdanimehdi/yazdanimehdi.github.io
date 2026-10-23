// The reading room's steps. Each has maxRetries = 0, so a retry never skips arXiv's crawl delay or repeats an AI call.
import { generateText, missingAiKey, readAiConfig } from '../admin/ai';
import { getStore } from '../admin/get-store';
import { postgresOnly } from '../admin/http';
import { getSql } from '../db';
import type { Row } from './db';
import { fetchArxivText, textNeedFor, type TextStep } from './fetch-text';
import { allowedCites, loadGrounding } from './ground';
import { getNotebook, reserveArxivSlot, setOutput, useAiCall } from './room-db';
import { outputPrompt, parseOutput, pickPassages } from './room-prompts';
import type { OutputBody, OutputKind } from './types';

/** These steps only read content. */
const BOT = { name: 'ScholarOS reading', email: 'scholaros-reading@users.noreply.github.com' };

export async function textNeed(paperId: number): Promise<TextStep | null> {
  'use step';
  return textNeedFor(getSql(), paperId);
}
textNeed.maxRetries = 0;

/** How long to wait (ms) for the next site-wide arXiv slot, which is now this run's. */
export async function reserveArxiv(): Promise<number> {
  'use step';
  return reserveArxivSlot(getSql());
}
reserveArxiv.maxRetries = 0;

export async function fetchTextStep(paperId: number, step: TextStep): Promise<{ next: TextStep | null; ok: boolean }> {
  'use step';
  return fetchArxivText(getSql(), paperId, step);
}
fetchTextStep.maxRetries = 0;

/**
 * Writes the output (a summary or study aid of a paper or notebook) from the papers' stored text. Never throws: every
 * failure, from missing text to the daily cap to the provider, is the row's `error`. A reply without the output is
 * asked for again once.
 */
export async function writeOutput(outputId: number): Promise<void> {
  'use step';
  const sql = getSql();
  const fail = (error: string) => setOutput(sql, outputId, { status: 'failed', error });
  let body: OutputBody;
  try {
    const [row] = await sql<Row>`select kind, paper_id, notebook_id from reading_outputs where id = ${outputId}`;
    if (!row) return;
    const kind = row.kind as OutputKind;
    const ids =
      row.paper_id != null
        ? [Number(row.paper_id)]
        : ((await getNotebook(sql, Number(row.notebook_id)))?.paperIds ?? []);
    if (!ids.length) return await fail('This notebook has no papers yet.');
    const store = postgresOnly(getStore(BOT));
    const g = await loadGrounding(sql, store, ids);
    const broken = g.unread.find((u) => u.error);
    if (broken) return await fail(`Couldn't fetch the text of “${broken.title}”: ${broken.error}`);
    const ai = await readAiConfig(store);
    const missing = await missingAiKey(sql, ai);
    if (missing) return await fail(missing);
    const cap = g.prefs.roomAiCalls;
    const day = new Date().toISOString().slice(0, 10);
    const papers = pickPassages(g.papers, null);
    const allowed = allowedCites(papers, g.scan);
    const prompt = outputPrompt(kind, papers, g.profile, g.scan);
    for (let call = 1; ; call++) {
      if (!(await useAiCall(sql, day, cap)))
        return await fail(`Today’s ${cap} reading-room AI calls are used up. Try again tomorrow.`);
      const reply = await generateText(store, ai, prompt);
      try {
        body = parseOutput(reply, kind, ids, allowed, g.mine);
        break;
      } catch (e) {
        if (call === 2) throw e;
      }
    }
  } catch (e) {
    // Thrown inside the step, so not wrapped by the Workflow SDK: the message is the error's own.
    return await fail(String((e as Error)?.message ?? e).slice(0, 300));
  }
  await setOutput(sql, outputId, { status: 'ready', body, error: null });
}
writeOutput.maxRetries = 0;
