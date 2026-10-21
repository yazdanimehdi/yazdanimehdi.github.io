# Complete paper import — design

## Why

The owner imported MIRAGE from Google Scholar and got a messy entry: the Scholar link instead of the arXiv page, no
arXiv id, authors as Scholar abbreviates them ("M Yazdani-Jahromi"), no abstract, and no proper BibTeX. Scholar's
author list (SerpAPI `google_scholar_author`, `src/lib/admin/papers.ts`) only knows titles, abbreviated and often
truncated ("…") author strings, a venue string and a Scholar link; the abstract is fetched only when a post is
drafted, and then as Scholar's snippet. Papers already on the site are never revisited.

The owner wants every paper complete and correct without hand work, especially papers on arXiv, and wants existing
papers that lack information completed too.

## Goals

- **Complete metadata** for each paper from its real source: full author names, the paper's own link, arXiv id, PDF
  link, full abstract, DOI, venue, and a proper BibTeX entry.
- **arXiv first.** When a paper is on arXiv, the arXiv record is the source for authors, abstract, arXiv id, `url`
  (the `https://arxiv.org/abs/<id>` page, without version) and `pdf` (`https://arxiv.org/pdf/<id>`).
- **Published version via DOI.** When the paper has a DOI (from arXiv's `arxiv:doi`, from Crossref, or already on the
  entry), Crossref supplies the published venue, the DOI, and the publisher's BibTeX. A paper only on arXiv keeps
  venue "arXiv" / type `preprint` and an arXiv-style BibTeX.
- **New papers** found by the Scholar sync are completed automatically as they are imported (no hand edits exist yet).
- **Existing papers** are completed from a **Complete papers** button on the Publications screen.
  - Fields that are empty are filled.
  - Fields that would change are shown to the owner field by field, old next to new, with a checkbox per field;
    nothing is replaced until the owner approves (the owner's words: "replace what I have with prompted permission").
  - The nightly run does not touch existing papers.

## Non-goals

- Changing how Scholar discovers papers (it stays the list of what exists).
- Fetching full texts, figures or citation counts.
- Touching the owner's own fields: `topic`, `featured`, `image`, `note`, `venueShort`, `code`,
  `equalContribution`, and any post written about a paper.

## Anti-goals (a failure even if it "works")

- Silently overwriting anything the owner wrote.
- Attaching the wrong paper: a title-only match that's wrong. Matching must check authors too; anything uncertain is
  shown to the owner, never applied automatically.
- Scraping against a site's rules. arXiv: use the export API (`export.arxiv.org/api/query`) only, at most one request
  every 3 seconds, as its API terms ask; never scrape arxiv.org pages. Crossref: its public REST API with a `mailto`
  in the User-Agent (its "polite pool"); DOI BibTeX via content negotiation on `https://doi.org/<doi>` with
  `Accept: application/x-bibtex`. Both go through the existing safe fetch (`src/lib/career/sources/http.ts`-style:
  timeout, size cap, http(s) only) — no new dependency.
- Spending SerpAPI credits on this: the completion step uses only the free sources above.

## How (decided)

- **Matching.** Look up a paper by arXiv id if the entry already has one or its `url`/`pdf` points at arXiv; else by
  DOI if it has one; else by a title search (arXiv `ti:` phrase search, then Crossref `query.bibliographic`). A title
  match counts only when the folded titles are equal (same folding as `normalizeTitle`) **and** at least one author
  surname from the entry appears in the candidate's authors. Otherwise: no match (new papers stay as imported from
  Scholar; existing ones show "no confident match" in the review).
- **Authors.** The source's full names, in the source's order, replace an abbreviated list. For new papers this is
  automatic; for existing papers it's a proposed change.
- **BibTeX.** Publisher BibTeX via DOI content negotiation when a DOI exists; otherwise build arXiv's own format
  (`@misc{<key>, title, author, year, eprint, archivePrefix = {arXiv}, primaryClass, url}`) from the API record. The
  key follows the existing publication id scheme (`generateId`).
- **Type and venue.** Published venue from Crossref's `container-title` and `type` (journal-article → `journal`,
  proceedings-article → `conference`); arXiv-only → `preprint`, venue `arXiv`.
- **Where it runs.** A pure module (e.g. `src/lib/admin/paper-complete.ts`) that, given an entry, returns the
  completed fields and per-field changes; `syncPapers` applies it to new papers; a new route under
  `/api/admin/papers/` computes proposals for all existing publications (or one) and a second route applies the
  fields the owner ticked, through the same content store and change path the editor uses (works in git and Postgres
  modes).

## Decided after review (the designer's calls, not the owner's)

1. **Venue and type change only on proof of publication.** Proof is a DOI record from Crossref, or arXiv's
   `arxiv:journal_ref`. When arXiv matches but gives no DOI, run one Crossref title search (same matching rule) for a
   published version. Without proof, keep the existing (or Scholar's) venue and type; never downgrade a non-arXiv
   venue to `arXiv`/`preprint`. MIRAGE's rule is the arXiv-only case: venue `arXiv`, type `preprint`.
2. **The git-mode Python sync stops overwriting.** `scripts/sync-scholar.py` `merge_with_existing` keeps adding new
   papers but no longer overwrites `title`, `authors`, `venue` or `year` on existing entries (it would undo completed
   author names every Monday). It does not do completion itself; completed fields come from the TS path (new papers
   via the admin sync, existing ones via the button).
3. **The proposal route only reads; one Apply route writes.** Empty fields appear in the review already ticked;
   nothing is written until "Apply selected" — one write per applied paper through the normal change path.
4. **Title and year are in scope.** Title: the source's title is offered when it differs from the stored one in
   anything but whitespace (Scholar often lower-cases). Year: Crossref's published year when there's proof of
   publication, else arXiv's first-submission year. For new papers both apply automatically; for existing ones they're
   proposals. The publication's slug never changes after import (only BibTeX's key uses `generateId`).
5. **Declined changes stay declined.** Record each declined `(paper, field, proposed value)` in the papers state
   (alongside `scholar.json`'s seen list, through the store); the same proposal isn't offered again, a different
   proposed value is.
6. **A budget per run.** The Scholar sync completes at most 10 new papers per run (about 30–60 s of paced arXiv
   calls); the rest import as Scholar gives them and are reported as `not completed` — the button finishes them. If
   arXiv or Crossref fails, the paper imports uncompleted, and the run reports the source's error. The button runs
   per batch of 10 with progress shown, so no request outlives the function limit.

## Left to the builder

- The exact review UI on the Publications screen (a modal or panel listing papers with proposed changes; per-field
  checkboxes; "Apply selected"), following the admin's existing patterns.
- Rate-limit pacing (a run over ~20 papers at one arXiv call per 3 s takes about a minute; show progress or batch).
- How abstracts are cleaned (arXiv summaries: collapse whitespace; Crossref JATS abstracts: strip tags).
- Test fixtures: recorded arXiv Atom and Crossref JSON responses, including MIRAGE (`2609.14491`, 3 authors) as the
  acceptance case.

## Acceptance

Importing or completing MIRAGE yields: three full author names, `url` `https://arxiv.org/abs/2609.14491`, `arxiv`
`2609.14491`, `pdf` `https://arxiv.org/pdf/2609.14491`, the full abstract, type `preprint` (unless a published DOI
exists), and a BibTeX entry — and on an existing, hand-edited MIRAGE entry, every differing field is offered for
approval rather than written.
