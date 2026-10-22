import test from 'node:test';
import assert from 'node:assert/strict';
import { primary, reasonLine, resurfaces, signalLine, tractionScore } from './rank';

test('primary picks upvotes, citations and visits', () => {
  assert.deepEqual(
    primary({
      huggingface: { upvotes: 3, comments: 1, since: '2026-10-20' },
      openalex: { citations: 4, since: '2026-10-01' },
      alphaxiv: { visits: 5, votes: 9 },
      bluesky: { posts: 7, capped: false },
    }),
    { huggingface: 3, openalex: 4, alphaxiv: 5 },
  );
});

test('tractionScore is 0 without a primary signal', () => {
  const max = { huggingface: 300, openalex: 40, bluesky: 10 };
  assert.equal(tractionScore({}, max), 0);
  assert.equal(tractionScore({ bluesky: { posts: 10, capped: false } }, max), 0);
  assert.equal(
    tractionScore({ openalex: { citations: 0, since: '2026-10-01' }, bluesky: { posts: 10, capped: false } }, max),
    0,
  );
});

test('tractionScore compares each source against its own maximum', () => {
  const max = { huggingface: 300, openalex: 40, bluesky: 20 };
  const hf = { huggingface: { upvotes: 300, comments: 0, since: '2026-10-20' } };
  const oa = { openalex: { citations: 10, since: '2026-10-01' } };
  assert.equal(tractionScore(hf, max), 1);
  assert.equal(tractionScore(oa, max), 0.25);
  // The best source counts, not the sum; Bluesky adds half its share.
  assert.equal(tractionScore({ ...hf, ...oa }, max), 1);
  assert.equal(tractionScore({ ...oa, bluesky: { posts: 10, capped: false } }, max), 0.5);
  // A source with no maximum tonight adds nothing.
  assert.equal(tractionScore({ ...oa, alphaxiv: { visits: 50, votes: 1 } }, max), 0.25);
});

test('resurfaces only when a number doubled', () => {
  const shown = { huggingface: { upvotes: 100, comments: 2, since: '2026-10-20' } };
  const hf = (upvotes: number) => ({ huggingface: { upvotes, comments: 9, since: '2026-10-20' } });
  assert.equal(resurfaces(hf(199), shown), false);
  assert.equal(resurfaces(hf(200), shown), true);
  // Bluesky is not a primary number.
  assert.equal(
    resurfaces(
      { ...hf(150), bluesky: { posts: 100, capped: true } },
      { ...shown, bluesky: { posts: 1, capped: false } },
    ),
    false,
  );
  // A source that had nothing when shown now has something.
  assert.equal(resurfaces({ ...hf(100), alphaxiv: { visits: 40, votes: 1 } }, shown), true);
  assert.equal(resurfaces({ ...hf(100), alphaxiv: { visits: 0, votes: 0 } }, shown), false);
});

test('signalLine', () => {
  const now = new Date('2026-10-22T03:00:00Z');
  assert.equal(
    signalLine(
      {
        huggingface: { upvotes: 312, comments: 14, since: '2026-10-20T00:00:00.000Z' },
        openalex: { citations: 40, since: '2026-09-12' },
        alphaxiv: { visits: 1617, votes: 105 },
        bluesky: { posts: 23, capped: false },
      },
      now,
    ),
    '312 upvotes and 14 comments on Hugging Face in 2 days · cited 40 times since 12 Sep 2026 (OpenAlex) · 1,617 visits on alphaXiv this week · 23 Bluesky posts',
  );
  assert.equal(
    signalLine({ huggingface: { upvotes: 9, comments: 0, since: '2026-10-21T20:00:00.000Z' } }, now),
    '9 upvotes on Hugging Face in 1 day',
  );
  assert.equal(signalLine({ bluesky: { posts: 100, capped: true } }, now), '100+ Bluesky posts');
});

test('reasonLine adds the related paper when set', () => {
  assert.equal(reasonLine({ reason: 'Uses your method', related: null }), 'Uses your method');
  assert.equal(
    reasonLine({ reason: 'Uses your method', related: 'Graph kernels' }),
    'Uses your method · Close to your “Graph kernels”',
  );
});
