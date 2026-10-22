import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  arxivBibtex,
  parseArxivFeed,
  parseBiorxiv,
  parseCrossrefWorks,
  parseOpenAlex,
  parsePubmed,
} from './paper-sources';

const fixture = (name: string) =>
  fs.readFileSync(new URL(`../../../tests/fixtures/papers/${name}`, import.meta.url), 'utf8');

test('parseArxivFeed reads MIRAGE in full', () => {
  const [r] = parseArxivFeed(fixture('arxiv-mirage.xml'));
  assert.equal(r.source, 'arxiv');
  assert.equal(r.arxiv, '2609.14491');
  assert.match(r.title, /^MIRAGE: Measuring Interpolation and Redundancy in Affinity GEneralization/);
  assert.equal(r.authors.length, 3);
  assert.ok(r.authors.includes('Mehdi Yazdani-Jahromi'));
  assert.ok((r.abstract ?? '').length > 300 && !/\n/.test(r.abstract!));
  assert.equal(r.year, 2026);
});

test('parseArxivFeed handles several entries and entities', () => {
  const rs = parseArxivFeed(fixture('arxiv-search.xml'));
  assert.ok(rs.length >= 2 && rs.every((r) => r.arxiv && !/v\d+$/.test(r.arxiv)));
  assert.equal(parseArxivFeed('<feed></feed>').length, 0);
  const [e] = parseArxivFeed(
    '<feed><entry><id>http://arxiv.org/abs/1234.5678v2</id><title>A &amp; B &lt;x&gt; &#8211; &#x41;</title><summary> a\n b </summary><published>2020-01-02T00:00:00Z</published><arxiv:primary_category term="cs.LG"/><arxiv:journal_ref>J. 1 (2021)</arxiv:journal_ref><arxiv:doi>10.1/x</arxiv:doi><author><name>Ann Lee</name></author></entry></feed>',
  );
  assert.equal(e.title, 'A & B <x> – A');
  assert.equal(e.abstract, 'a b');
  assert.equal(e.journalRef, 'J. 1 (2021)');
  assert.equal(e.doi, '10.1/x');
  assert.equal(e.primaryClass, 'cs.LG');
});

test('parseCrossrefWorks maps authors, year, venue and type', () => {
  const [r] = parseCrossrefWorks(JSON.parse(fixture('crossref-search.json')));
  assert.equal(r.doi, '10.52202/085713-0904');
  assert.deepEqual(r.authors.slice(0, 2), ['Mehdi Yazdani-Jahromi', 'Ali Khodabandeh Yalabadi']);
  assert.ok(r.venue && r.year > 2000);
  assert.equal(r.type, 'conference');
  assert.deepEqual(parseCrossrefWorks({}), []);
});

test('parseCrossrefWorks strips JATS from abstracts', () => {
  const [r] = parseCrossrefWorks({
    message: {
      items: [
        {
          title: ['T'],
          DOI: '10.1/a',
          type: 'posted-content',
          abstract: '<jats:p>Hi <jats:italic>there</jats:italic></jats:p>',
          author: [{ family: 'Solo' }],
          issued: { 'date-parts': [[2022]] },
        },
      ],
    },
  });
  assert.equal(r.abstract, 'Hi there');
  assert.deepEqual(r.authors, ['Solo']);
  assert.equal(r.type, 'preprint');
});

test("arxivBibtex writes arXiv's format", () => {
  const [r] = parseArxivFeed(fixture('arxiv-mirage.xml'));
  const b = arxivBibtex(r, 'yazdanijahromi2026mirage');
  assert.match(b, /^@misc\{yazdanijahromi2026mirage,/);
  assert.match(b, /eprint = \{2609\.14491\}/);
  assert.match(b, /archivePrefix = \{arXiv\}/);
  assert.match(b, /author = \{[^}]+ and [^}]+ and [^}]+\}/);
  assert.match(b, /url = \{https:\/\/arxiv\.org\/abs\/2609\.14491\}/);
});

test('parseBiorxiv keeps authors as given and sets the venue', () => {
  const [r] = parseBiorxiv(JSON.parse(fixture('biorxiv.json')), 'biorxiv');
  assert.equal(r.source, 'biorxiv');
  assert.equal(r.doi, '10.1101/2023.12.31.573522');
  assert.equal(r.authors[0], 'Penker, S.');
  assert.ok(r.authors.length > 3 && (r.abstract ?? '').length > 100);
  assert.equal(r.venue, 'bioRxiv');
  assert.equal(r.type, 'preprint');
  assert.equal(r.year, 2024);
  const [m] = parseBiorxiv(
    { collection: [{ title: 'T', authors: 'A, B.', doi: '10.1101/x', date: '2021-03-04', published: '10.1/pub' }] },
    'medrxiv',
  );
  assert.equal(m.venue, 'medRxiv');
  assert.equal(m.publishedDoi, '10.1/pub');
});

test('parsePubmed reads full names, abstract and DOI', () => {
  const [r] = parsePubmed(fixture('pubmed.xml'));
  assert.equal(r.source, 'pubmed');
  assert.match(r.title, /^BindingSite-AugmentedDTA/);
  assert.ok(r.authors.includes('Mehdi Yazdani-Jahromi'));
  assert.ok((r.abstract ?? '').length > 200);
  assert.equal(r.doi, '10.1093/bib/bbad136');
  assert.equal(r.venue, 'Briefings in bioinformatics');
  assert.equal(r.year, 2023);
  assert.equal(r.type, 'journal');
});

test('parseOpenAlex rebuilds the abstract and maps fields', () => {
  const [r] = parseOpenAlex(JSON.parse(fixture('openalex.json')));
  assert.equal(r.source, 'openalex');
  assert.match(r.title, /^HELM/);
  assert.ok(r.authors.includes('Mehdi Yazdani-Jahromi'));
  assert.ok((r.abstract ?? '').length > 200);
  assert.equal(r.doi, '10.48550/arxiv.2410.12459');
  assert.equal(r.type, 'preprint');
  assert.equal(r.year, 2024);
  assert.match(r.pdf ?? '', /^https:\/\/arxiv\.org\/pdf\//);
});

test('parseOpenAlex takes the type from the venue: conference, journal, or no proof for a repository', () => {
  const [w] = JSON.parse(fixture('openalex.json')).results;
  const as = (sourceType: string | undefined, pdf = 'https://x.test/a.pdf') =>
    parseOpenAlex({
      results: [
        {
          ...w,
          type: 'article',
          primary_location: { source: sourceType ? { display_name: 'V', type: sourceType } : null },
          best_oa_location: { pdf_url: pdf },
        },
      ],
    })[0];
  assert.equal(as('conference').type, 'conference');
  assert.equal(as('journal').type, 'journal');
  assert.equal(as('repository').type, undefined);
  assert.equal(as(undefined).type, undefined);
  assert.equal(as('journal', 'javascript:alert(1)').pdf, undefined);
});

test('parseArxivFeed drops invalid numeric character references', () => {
  const [e] = parseArxivFeed(
    '<feed><entry><id>http://arxiv.org/abs/1234.5678v1</id><title>a&#99999999;b&#xD800;c&#0;d</title><published>2020-01-02T00:00:00Z</published></entry></feed>',
  );
  assert.equal(e.title, 'abcd');
});
