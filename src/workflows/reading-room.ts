import { getRun, start } from 'workflow/api';
import { CLAIM } from '../lib/career/db';
import type { Sql } from '../lib/db';
import { getPapers } from '../lib/reading/db';
import { claimOutput, getNotebook, getOutputs, setOutput } from '../lib/reading/room-db';
import { writeOutput } from '../lib/reading/room-steps';
import type { OutputKind, Target } from '../lib/reading/types';
import { finished } from './career-draft';
import { errorText, type Runs } from './runs';
import { ensureTexts } from './texts';

type RoomJob = { papers: number[]; outputId: number | null };

/** Fetches the papers' missing texts at arXiv's crawl delay, then writes the output when there is one. */
export async function readingRoom(job: RoomJob): Promise<void> {
  'use workflow';
  await ensureTexts(job.papers);
  if (job.outputId !== null) await writeOutput(job.outputId);
}

/** A reading-room run that still says running after this is stuck (it waits on arXiv, then one or two AI calls). */
export const STALE_MS = 15 * 60_000;

/** The slice of the Workflow API startRoomRun uses; tests pass their own. */
export interface RoomRuns {
  get: Runs['get'];
  start(job: RoomJob): Promise<{ runId: string }>;
}
const workflowRuns: RoomRuns = { get: getRun, start: (job) => start(readingRoom, [job]) };
let testRuns: RoomRuns | null = null;

/** Tests swap the Workflow API; production code never calls this. */
export function setRoomRunsForTests(runs: RoomRuns | null): void {
  testRuns = runs;
}

/**
 * Starts a run for the paper or notebook: `kind` null (Save) only fetches the texts; otherwise the output is marked
 * running and written. `'running'` when that output's run is still going (one stuck for 15 minutes no longer counts),
 * `'empty'` for a notebook with no papers, null when there is no such paper or notebook.
 */
export async function startRoomRun(
  sql: Sql,
  target: Target,
  kind: OutputKind | null,
  runs: RoomRuns = testRuns ?? workflowRuns,
  now = Date.now(),
): Promise<{ runId: string } | 'running' | 'empty' | null> {
  let papers: number[];
  if ('paper' in target) {
    if (!(await getPapers(sql, [target.paper])).length) return null;
    papers = [target.paper];
  } else {
    const notebook = await getNotebook(sql, target.notebook);
    if (!notebook) return null;
    papers = notebook.paperIds;
    if (!papers.length) return 'empty';
  }
  if (!kind) return runs.start({ papers, outputId: null });

  const row = (await getOutputs(sql, target))[kind];
  if (row?.status === 'running' && !(await finished(row.runId, runs, now, STALE_MS))) return 'running';
  // A conditional claim, so two clicks can't both start a run: the second no longer finds the run_id it read.
  const claim = CLAIM + now;
  const id = await claimOutput(sql, target, kind, row ? { runId: row.runId } : null, claim);
  if (id === null) return 'running';
  let runId: string;
  try {
    ({ runId } = await runs.start({ papers, outputId: id }));
  } catch (e) {
    await setOutput(sql, id, { status: 'failed', error: errorText(e), runId: null });
    throw e;
  }
  // Only over our own claim: a run that already finished keeps its status.
  await sql`update reading_outputs set run_id = ${runId} where id = ${id} and run_id = ${claim}`;
  return { runId };
}
