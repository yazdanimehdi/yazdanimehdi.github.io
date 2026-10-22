-- Paper digest (Postgres mode, owner only). Not under `documents`, so the git backup and `db:export` never see it.
create table if not exists reading_settings (
  id int primary key default 1 check (id = 1),
  prefs jsonb not null default '{}',
  last_run jsonb,
  run_id text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists reading_papers (
  id bigserial primary key,
  key text not null unique, -- 'arxiv:<id>' | 'doi:<lowercase doi>' | 'pmid:<n>'
  arxiv text,
  doi text,
  pmid text,
  source text not null, -- the first source that found it
  title text not null,
  authors jsonb not null default '[]',
  abstract text,
  url text not null,
  published_at date,
  categories jsonb not null default '[]',
  signals jsonb not null default '{}', -- Signals, latest values, merged per source
  score int,
  reason text,
  related text,
  scored_at timestamptz,
  state text not null default 'new' check (state in ('new','saved','dismissed')),
  state_at timestamptz,
  found_at timestamptz not null default now()
);

create table if not exists reading_digest (
  day date not null,
  paper_id bigint not null references reading_papers (id) on delete cascade,
  section text not null check (section in ('talked','field','unranked')),
  rank int not null,
  line text not null, -- the signal or reason line as shown that day
  signals jsonb, -- the numbers when shown (talked only), for resurfacing
  primary key (day, paper_id)
);
create index if not exists reading_digest_paper on reading_digest (paper_id, day desc);

-- Project 1 stores the fetched text raw; Project 2 adds the passages table and splits it.
create table if not exists reading_texts (
  paper_id bigint primary key references reading_papers (id) on delete cascade,
  source text not null,
  body text,
  error text,
  fetched_at timestamptz not null default now()
);
