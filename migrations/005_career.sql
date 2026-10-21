-- Job search (Postgres mode, owner only). Not under `documents`, so the git backup and the generic config API never see it.
create table if not exists career_settings (
  id int primary key default 1 check (id = 1),
  prefs jsonb not null default '{}',
  answers jsonb not null default '{}',
  last_run jsonb,
  run_id text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists career_postings (
  id bigserial primary key,
  key text not null unique,
  source text not null,
  external_id text not null,
  company text not null,
  title text not null,
  location text,
  remote boolean,
  url text not null,
  apply_url text,
  description text not null, -- the guarded text, never the raw ad
  flags jsonb not null default '{}',
  salary jsonb,
  ats jsonb,
  posted_at timestamptz,
  found_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  gate text,
  score int,
  score_detail jsonb,
  score_error text,
  scored_at timestamptz,
  status text not null default 'found' check (status in
    ('found','skipped','drafted','ready','submitted','interview','offer','rejected','no-response','withdrawn')),
  notes text not null default '',
  cv jsonb,
  cv_style text,
  cv_pdf_url text,
  letter text,
  answers jsonb,
  draft_state text not null default 'none' check (draft_state in ('none','running','done','needs-review','failed')),
  draft_issues jsonb,
  draft_run_id text
);
create index if not exists career_postings_score on career_postings (score desc);
create index if not exists career_postings_status on career_postings (status);

create table if not exists career_events (
  id bigserial primary key,
  posting_id bigint not null references career_postings (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  detail text
);
create index if not exists career_events_posting on career_events (posting_id, id desc);
