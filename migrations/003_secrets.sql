-- Provider API keys typed into the admin (Postgres mode), AES-GCM sealed with a key derived from SESSION_SECRET.
-- Not under `documents`, so the git backup never sees them.
create table if not exists secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
