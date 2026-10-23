-- Public readings and notes: what the owner marks public. The published copies are built from these elsewhere.
alter table vault_notes add column if not exists uid uuid not null default gen_random_uuid(); -- the graph's id
alter table vault_notes add column if not exists public boolean not null default false;
alter table vault_notes add column if not exists public_slug text; -- fixed at first publish, kept after unpublish
alter table vault_notes add column if not exists public_at timestamptz; -- first publish, kept
alter table vault_notes drop constraint if exists vault_notes_public_not_chat;
alter table vault_notes add constraint vault_notes_public_not_chat check (not public or kind <> 'chat');
create unique index if not exists vault_notes_uid on vault_notes (uid);
create unique index if not exists vault_notes_public_slug on vault_notes (public_slug) where public_slug is not null;

alter table reading_highlights add column if not exists public boolean not null default false;
