-- Password accounts for the admin (Postgres mode). Usernames are stored lowercase.
create table if not exists admin_users (
  username text primary key,
  name text not null,
  password_hash text not null,
  session_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Failed sign-ins, for throttling (also for usernames that don't exist).
create table if not exists login_attempts (
  username text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_username_at_idx on login_attempts (username, at desc);
