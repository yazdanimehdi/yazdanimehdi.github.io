import { getRun, start } from 'workflow/api';
import type { Sql } from '../lib/db';
import { readReading, writeReading } from '../lib/reading/db';
import { topByOverlap } from '../lib/reading/match';
import {
  aiMissing,
  areaFilter,
  blueskyStep,
  collectNew,
  collectTraction,
  emailStep,
  finishReading,
  pruneStep,
  readingPlan,
  saveDigestStep,
  scoreBatch,
  tractionShortlist,
} from '../lib/reading/steps';
import type { ReadingRun } from '../lib/reading/types';
import { errorText, startUnlessRunning, type Runs } from './runs';
import { ensureTexts } from './texts';

const BATCH = 10;
const POOL = 60;
const NOTHING = { ranked: 0, unranked: 0, aiCalls: 0, talked: 0, inField: 0, texts: { fetched: 0, failed: 0 } };

/**
 * The night's paper digest: collect the new papers and keep the 60 closest to the keywords; score them ten at a time
 * up to the AI cap (a provider error stops ranking); collect the talked-about papers and keep those in the wider
 * area; save the day's digest, prefetch its texts (arXiv's at its crawl delay), and email it.
 */
export async function readingNightly(): Promise<ReadingRun> {
  'use workflow';
  const plan = await readingPlan();
  const { day } = plan;
  if (plan.paused) {
    const run: ReadingRun = { at: new Date().toISOString(), day, paused: true, sources: [], ...NOTHING };
    await finishReading(run);
    return run;
  }

  await pruneStep();
  const collected = await Promise.all(plan.newSources.map((id) => collectNew(id, day)));
  const pool = topByOverlap(
    collected.flatMap((c) => c.candidates),
    (c) => c.overlap,
    POOL,
  ).map((c) => c.id);

  let aiCalls = 0;
  let stopped: string | undefined;
  if (pool.length) {
    stopped = (await aiMissing()) ?? undefined;
    // The cap running out is not `stopped`: what's left is counted as unranked.
    for (let i = 0; !stopped && i < pool.length && aiCalls < plan.maxAiCalls; i += BATCH) {
      try {
        aiCalls += await scoreBatch(pool.slice(i, i + BATCH));
      } catch (e) {
        stopped = errorText(e);
      }
    }
  }

  const traction = await Promise.all(plan.tractionSources.map((id) => collectTraction(id, day)));
  let talked = await tractionShortlist(
    traction.flatMap((t) => t.ids),
    day,
    plan.talked,
  );
  let talkedSkipped: ReadingRun['talkedSkipped'];
  if (talked.length && plan.area) {
    if (stopped) talkedSkipped = 'ranking stopped';
    else if (aiCalls >= plan.maxAiCalls) talkedSkipped = 'AI cap spent';
    else {
      try {
        talked = await areaFilter(talked);
        aiCalls++;
      } catch (e) {
        stopped = errorText(e);
        talkedSkipped = 'ranking stopped';
      }
    }
    if (talkedSkipped) talked = [];
  }
  if (plan.bluesky && talked.length) await blueskyStep(talked, day);

  const digest = await saveDigestStep({ day, talked, pool, stopped: !!stopped });
  const texts = await ensureTexts(digest.prefetch);

  const run: ReadingRun = {
    at: new Date().toISOString(),
    day,
    sources: [...collected, ...traction].map(({ id, found, added, error }) => ({
      id,
      found,
      added,
      ...(error ? { error } : {}),
    })),
    ranked: pool.length - digest.unranked,
    unranked: digest.unranked,
    aiCalls,
    talked: digest.talked,
    inField: digest.inField,
    texts,
    ...(stopped ? { stopped } : {}),
    ...(talkedSkipped ? { talkedSkipped } : {}),
  };
  run.email = await emailStep(day);
  await finishReading(run);
  return run;
}

const workflowRuns: Runs = { get: getRun, start: () => start(readingNightly) };
let testRuns: Runs | null = null;

/** Tests swap the Workflow API; production code never calls this. */
export function setReadingRunsForTests(runs: Runs | null): void {
  testRuns = runs;
}

/** Starts tonight's digest unless the last run is still pending or running (one stuck for 6 hours is cancelled). */
export async function startReading(
  sql: Sql,
  runs: Runs = testRuns ?? workflowRuns,
  now = Date.now(),
): Promise<{ runId: string } | { running: string }> {
  const { runId } = await readReading(sql);
  return startUnlessRunning(runs, runId, (id) => writeReading(sql, { runId: id }, 'ScholarOS reading'), now);
}
