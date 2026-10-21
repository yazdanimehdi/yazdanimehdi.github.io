import { start } from 'workflow/api';
import { draftStep, failDraft, finishDraft, renderStep, reviewStep, scoreReady, startDraft } from '../lib/career/steps';
import type { DraftPart, ReviewIssue } from '../lib/career/tailor';

/** A step's own message: past its retries the SDK wraps the original error as `cause` (no classes cross over). */
function reasonOf(e: unknown): string {
  const err = e as { message?: unknown; cause?: { message?: unknown } } | null;
  return String(err?.cause?.message ?? err?.message ?? 'unexpected error');
}

/**
 * A tailored CV and cover letter for one posting: draft, review, one revision when the review finds issues, then
 * render. `render` skips the AI (the owner edited the plan); `letter` doesn't re-render.
 */
export async function careerDraft(id: number, part: DraftPart, instruction: string): Promise<void> {
  'use workflow';
  try {
    await startDraft(id, part);
    let review: { ok: boolean; issues: ReviewIssue[] } | null = null;
    if (part !== 'render') {
      const failed = (await scoreReady()) ?? (await draftStep(id, part, instruction, null));
      if (failed) return await failDraft(id, failed);
      review = await reviewStep(id);
      if (!review.ok) {
        const again = await draftStep(id, part, instruction, review.issues);
        if (again) return await failDraft(id, again);
        review = await reviewStep(id);
      }
    }
    if (part !== 'letter') {
      const failed = await renderStep(id);
      if (failed) return await failDraft(id, failed);
    }
    await finishDraft(id, review);
  } catch (e) {
    await failDraft(id, reasonOf(e));
  }
}

type StartDraft = (id: number, part: DraftPart, instruction: string) => Promise<{ runId: string }>;
let testStart: StartDraft | null = null;

/** Tests swap the Workflow API; production code never calls this. */
export function setDraftStartForTests(fn: StartDraft | null): void {
  testStart = fn;
}

export const startDraftRun: StartDraft = (...args) => (testStart ? testStart(...args) : start(careerDraft, args));
