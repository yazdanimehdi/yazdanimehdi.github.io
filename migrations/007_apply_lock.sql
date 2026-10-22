-- One apply run at a time: the pre-fill or submit holding the apply sandbox, { postingId, kind, at }. It is taken in
-- the same transaction as the posting's claim and let go when that run settles; one older than 15 minutes is stale.
alter table career_settings add column if not exists apply_lock jsonb;
