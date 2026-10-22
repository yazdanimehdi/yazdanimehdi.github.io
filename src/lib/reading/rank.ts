// Ranking talked-about papers by their source numbers, and the lines the digest shows for them.
import type { Paper, Signals } from './types';

type Primary = 'huggingface' | 'openalex' | 'alphaxiv';

/** Each source's headline number: upvotes, citations, visits. */
export function primary(s: Signals): Partial<Record<Primary, number>> {
  const out: Partial<Record<Primary, number>> = {};
  if (s.huggingface) out.huggingface = s.huggingface.upvotes;
  if (s.openalex) out.openalex = s.openalex.citations;
  if (s.alphaxiv) out.alphaxiv = s.alphaxiv.visits;
  return out;
}

/** The best share of tonight's maximum over sources, plus half the Bluesky share; 0 without a primary number. */
export function tractionScore(s: Signals, max: Partial<Record<Primary | 'bluesky', number>>): number {
  const shares = Object.entries(primary(s))
    .filter(([, v]) => v > 0)
    .map(([k, v]) => v / (max[k as Primary] || Infinity));
  if (!shares.length) return 0;
  const bluesky = s.bluesky && max.bluesky ? (0.5 * s.bluesky.posts) / max.bluesky : 0;
  return Math.max(...shares) + bluesky;
}

/** Some primary number is at least double what was shown (a source absent then counts as 0). */
export function resurfaces(now: Signals, shown: Signals | null): boolean {
  const before = primary(shown ?? {});
  return Object.entries(primary(now)).some(([k, v]) => v > 0 && v >= 2 * (before[k as Primary] ?? 0));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const n = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

/** One part per source with a number above 0, joined with ' · '. */
export function signalLine(s: Signals, now: Date): string {
  const parts: string[] = [];
  const { huggingface: hf, openalex: oa, alphaxiv: ax, bluesky: bs } = s;
  if (hf?.upvotes) {
    const days = Math.max(1, Math.round((now.getTime() - Date.parse(hf.since)) / 86_400_000));
    const comments = hf.comments > 0 ? ` and ${n(hf.comments, 'comment')}` : '';
    parts.push(`${n(hf.upvotes, 'upvote')}${comments} on Hugging Face in ${n(days, 'day')}`);
  }
  if (oa?.citations) {
    const d = new Date(`${oa.since.slice(0, 10)}T00:00:00Z`);
    const since = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    parts.push(`cited ${n(oa.citations, 'time')} since ${since} (OpenAlex)`);
  }
  if (ax?.visits) parts.push(`${n(ax.visits, 'visit')} on alphaXiv this week`);
  if (bs?.posts) parts.push(bs.capped ? `${bs.posts}+ Bluesky posts` : n(bs.posts, 'Bluesky post'));
  return parts.join(' · ');
}

/** The AI's reason, then the owner's paper it is close to. */
export function reasonLine(p: Pick<Paper, 'reason' | 'related'>): string {
  return [p.reason, p.related && `Close to your “${p.related}”`].filter(Boolean).join(' · ');
}
