import test from 'node:test';
import assert from 'node:assert/strict';
import {
  becameDue,
  cssValue,
  formatMonthYear,
  formatNewsDate,
  formatShortDate,
  isPublished,
  postStatus,
  readingTime,
  safeHref,
  suggestSlug,
  withoutCrossPosted,
  withoutHidden,
} from './utils';

// West of UTC: date-only frontmatter (UTC midnight) must not slip to the previous day.
process.env.TZ = 'America/Los_Angeles';

test('formatNewsDate: formats at the requested precision', () => {
  const d = new Date('2025-10-03');
  assert.equal(formatNewsDate(d, 'day', 'en'), 'Oct 3, 2025');
  assert.equal(formatNewsDate(d, 'month', 'en'), 'Oct 2025');
  assert.equal(formatNewsDate(d, 'year', 'en'), '2025');
  assert.equal(formatNewsDate(d, undefined, 'en'), 'Oct 2025');
});

test('formatNewsDate: date-only values keep their day west of UTC', () => {
  assert.equal(formatNewsDate(new Date('2024-01-01'), 'day', 'en'), 'Jan 1, 2024');
  assert.equal(formatNewsDate(new Date('2024-01-01'), 'year', 'en'), '2024');
});

test('formatMonthYear: a malformed locale falls back to English; date-only stays its month west of UTC', () => {
  assert.equal(formatMonthYear(new Date('2024-01-01'), 'en_US'), 'January 2024');
  assert.equal(formatMonthYear(new Date('2024-01-01'), 'de'), 'Januar 2024');
});

test("date formatters: follow the site's locale; unset or malformed falls back to English", () => {
  const d = new Date('2025-10-03');
  assert.equal(formatNewsDate(d, 'day', 'de'), '3. Okt. 2025');
  assert.equal(formatNewsDate(d, 'day', undefined), 'Oct 3, 2025');
  assert.equal(formatNewsDate(d, 'day', 'not a tag!'), 'Oct 3, 2025');
  assert.equal(formatShortDate('2025-10-03T12:00:00Z', 'en'), 'Oct 3, 2025');
  assert.equal(formatShortDate('2025-10-03T12:00:00Z', 'fr'), '3 oct. 2025');
});

test('readingTime: ceil(words / 230), at least 1 minute', () => {
  assert.equal(readingTime(''), 1);
  assert.equal(readingTime('word '.repeat(230)), 1);
  assert.equal(readingTime('word '.repeat(231)), 2);
  assert.equal(readingTime('  spaced\n\nout\twords  '), 1);
});

test('withoutHidden drops listed feed ids only', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(withoutHidden(items, ['b', 'zzz']), [{ id: 'a' }, { id: 'c' }]);
  assert.deepEqual(withoutHidden(items, []), items);
});

test('isPublished: drafts never; dated posts from their instant on (date-only = UTC midnight)', () => {
  const now = new Date('2026-10-07T03:00:00Z');
  assert.equal(isPublished({ data: { draft: true, date: new Date('2020-01-01') } }, now), false);
  assert.equal(isPublished({ data: { date: new Date('2026-10-08') } }, now), false);
  assert.equal(isPublished({ data: { date: new Date('2026-10-06') } }, now), true);
  assert.equal(isPublished({ data: { date: new Date('2026-10-07T03:00:00Z') } }, now), true, 'boundary is public');
  assert.equal(
    isPublished({ data: { date: '2026-10-07' } }, now),
    true,
    'strings work (admin and scripts read raw YAML)',
  );
  assert.equal(isPublished({ data: { date: 'not a date' } }, now), false);
});

test('isPublished: datetime values (Sveltia) are compared to the minute', () => {
  const now = new Date('2026-10-07T09:00:00Z');
  assert.equal(isPublished({ data: { date: '2026-10-07T08:59:00Z' } }, now), true);
  assert.equal(isPublished({ data: { date: '2026-10-07T09:01:00Z' } }, now), false);
});

test('becameDue: public at `now` but not yet at `since`', () => {
  const since = new Date('2026-10-06T03:00:00Z');
  const now = new Date('2026-10-07T03:00:00Z');
  assert.equal(becameDue({ data: { date: '2026-10-07' } }, since, now), true);
  assert.equal(becameDue({ data: { date: '2026-10-05' } }, since, now), false, 'already public before');
  assert.equal(becameDue({ data: { date: '2026-10-08' } }, since, now), false, 'still in the future');
  assert.equal(becameDue({ data: { date: '2026-10-07', draft: true } }, since, now), false);
});

test('postStatus: Draft, Scheduled · date, Published', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  assert.equal(postStatus({ draft: true, date: '2030-01-01' }, now), 'Draft');
  assert.equal(postStatus({ date: '2026-10-08' }, now), 'Scheduled · 2026-10-08');
  assert.equal(postStatus({ date: '2026-10-07' }, now), 'Published');
  assert.equal(postStatus({}, now), 'Published');
});

test('withoutCrossPosted: hides feed copies of cross-posted site posts by link (query ignored) or normalized title', () => {
  const item = (link: string, title: string) => ({ id: link, data: { link, title } });
  const posts = [
    { data: { title: 'Fast  Proofs: A Tour!', medium: { url: 'https://medium.com/@jane/fast-proofs-a-tour-1a2b' } } },
    { data: { title: 'Only on the site' } },
  ];
  const kept = withoutCrossPosted(
    [
      item('https://medium.com/@jane/fast-proofs-a-tour-1a2b?source=rss-abc------2', 'Fast proofs: a tour'),
      item('https://medium.com/@jane/renamed-9z', 'fast proofs a tour'),
      item('https://medium.com/@jane/other-3c', 'A different essay'),
      item('https://medium.com/@jane/only-4d', 'Only on the site'),
    ],
    posts,
  );
  assert.deepEqual(
    kept.map((i) => i.data.title),
    ['A different essay', 'Only on the site'],
    'link match, title match; a same-titled post without a Medium URL hides nothing',
  );
});

test('withoutCrossPosted: http/https and www. are the same link; empty titles never match', () => {
  const item = (link: string, title: string) => ({ id: link, data: { link, title } });
  const posts = [
    { data: { title: 'Hello', medium: { url: 'https://medium.com/@jane/hello-1' } } },
    { data: { title: '!!!', medium: { url: 'https://medium.com/@jane/bang-2' } } },
  ];
  const kept = withoutCrossPosted(
    [item('http://www.medium.com/@jane/hello-1', 'Different title'), item('https://x.test/a', '???')],
    posts,
  );
  assert.deepEqual(
    kept.map((i) => i.data.title),
    ['???'],
  );
});

test('cssValue: a config value cannot leave its string, declaration, rule or the <style>', () => {
  assert.equal(cssValue('Source Serif 4'), 'Source Serif 4');
  assert.equal(cssValue('clamp(1rem, 2vw, 1.25rem)'), 'clamp(1rem, 2vw, 1.25rem)');
  assert.equal(cssValue('Roboto"; } </style><script>alert(1)</script>'), 'Roboto  /stylescriptalert(1)/script');
  assert.equal(cssValue('a\\"\n{b'), 'ab');
});

test('safeHref: http(s) links only; javascript:, data: and relative links give no href', () => {
  assert.equal(safeHref('https://ex.com/a'), 'https://ex.com/a');
  assert.equal(safeHref('HTTP://ex.com/a'), 'HTTP://ex.com/a');
  assert.equal(safeHref('javascript:alert(1)'), undefined);
  assert.equal(safeHref('JavaScript:alert(1)'), undefined);
  assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), undefined);
  assert.equal(safeHref('//ex.com/a'), undefined);
  assert.equal(safeHref(''), undefined);
  assert.equal(safeHref(undefined), undefined);
});

test('suggestSlug: at most 80 characters with no trailing dash; empty for a title with no ASCII letters', () => {
  assert.equal(suggestSlug('Hello, World!'), 'hello-world');
  const long = suggestSlug(`${'a'.repeat(79)} b ${'c'.repeat(20)}`);
  assert.equal(long, 'a'.repeat(79), 'cut at 80, then the dash left at the cut dropped');
  assert.ok(suggestSlug('word '.repeat(40)).length <= 80);
  assert.match(suggestSlug('word '.repeat(40)), /^[a-z0-9-]{1,80}$/);
  assert.equal(suggestSlug('سلام دنیا'), '');
});
