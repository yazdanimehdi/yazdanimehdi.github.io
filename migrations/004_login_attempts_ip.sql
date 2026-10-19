-- Sign-in throttling counts per (username, address), so one address can't lock the owner out.
alter table login_attempts add column if not exists ip text not null default '';
create index if not exists login_attempts_username_ip_at_idx on login_attempts (username, ip, at desc);
