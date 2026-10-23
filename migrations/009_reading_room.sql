-- The reading room (Postgres mode, owner only): full text split into passages, notebooks, AI outputs, chat,
-- highlights and notes. Own tables, so nothing reaches the public site, the git backup or `db:export`.
alter table reading_settings add column if not exists arxiv_at timestamptz; -- the latest reserved arXiv slot
alter table reading_texts add column if not exists note text; -- why only the abstract, shown on the page
alter table reading_texts add column if not exists pdf bytea; -- a scan (no text layer, <= 4 MB) for the AI
alter table reading_texts add column if not exists pages int; -- a PDF's page count

create table if not exists reading_passages (
  paper_id bigint not null references reading_papers (id) on delete cascade,
  pid text not null, -- 'S2.p3', 'S2.F1' (arXiv HTML element ids), 'p4.2' (PDF page 4, paragraph 2), 'abs.1'
  seq int not null, -- reading order
  kind text not null check (kind in ('h2','h3','h4','p','figure')),
  body text not null,
  tsv tsvector generated always as (to_tsvector('english', body)) stored,
  primary key (paper_id, pid)
);
create index if not exists reading_passages_tsv on reading_passages using gin (tsv);

create table if not exists reading_notebooks (
  id bigserial primary key,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reading_notebook_papers (
  notebook_id bigint not null references reading_notebooks (id) on delete cascade,
  paper_id bigint not null references reading_papers (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (notebook_id, paper_id)
);

-- Outputs, chats and notes belong to a paper or a notebook, never both.
create table if not exists reading_outputs (
  id bigserial primary key,
  paper_id bigint references reading_papers (id) on delete cascade,
  notebook_id bigint references reading_notebooks (id) on delete cascade,
  kind text not null check (kind in ('summary','briefing','faq','glossary')),
  status text not null check (status in ('running','ready','failed')),
  body jsonb,
  error text,
  run_id text,
  updated_at timestamptz not null default now(),
  check (num_nonnulls(paper_id, notebook_id) = 1)
);
create unique index if not exists reading_outputs_paper on reading_outputs (paper_id, kind) where paper_id is not null;
create unique index if not exists reading_outputs_notebook on reading_outputs (notebook_id, kind)
  where notebook_id is not null;

create table if not exists reading_chats (
  id bigserial primary key,
  paper_id bigint references reading_papers (id) on delete cascade,
  notebook_id bigint references reading_notebooks (id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  body text not null,
  cites jsonb not null default '[]',
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(paper_id, notebook_id) = 1)
);
create index if not exists reading_chats_paper on reading_chats (paper_id, id);
create index if not exists reading_chats_notebook on reading_chats (notebook_id, id);

-- No foreign key to passages: a highlight outlives its paper's text being replaced (shown by its quote).
create table if not exists reading_highlights (
  id bigserial primary key,
  paper_id bigint not null references reading_papers (id) on delete cascade,
  pid text not null,
  start_at int not null,
  end_at int not null check (end_at > start_at),
  quote text not null,
  comment text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists reading_highlights_paper on reading_highlights (paper_id);

create table if not exists reading_notes (
  paper_id bigint references reading_papers (id) on delete cascade,
  notebook_id bigint references reading_notebooks (id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  check (num_nonnulls(paper_id, notebook_id) = 1)
);
create unique index if not exists reading_notes_paper on reading_notes (paper_id) where paper_id is not null;
create unique index if not exists reading_notes_notebook on reading_notes (notebook_id) where notebook_id is not null;

create table if not exists reading_ai_use (day date primary key, calls int not null default 0);
