-- Assisted applying: the pre-filled form, its approval and its submission live on the posting.
alter table career_postings add column if not exists application jsonb;
alter table career_postings add column if not exists apply_run_id text;
alter table career_settings add column if not exists apply_queue_run_id text;
