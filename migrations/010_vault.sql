-- The vault (Postgres mode, owner only): Markdown notes on papers, saved answers and the owner's ideas, linked by
-- [[title]]. Own tables, so nothing reaches the public site, the git backup or `db:export`.
create table if not exists vault_notes (
  id bigserial primary key,
  kind text not null check (kind in ('paper','chat','free')),
  title text not null, -- the exported file's name and the [[link]] target
  body text not null default '', -- the owner's Markdown
  paper_id bigint references reading_papers (id) on delete restrict, -- a paper note's paper
  chat jsonb, -- a chat note's ChatSnapshot, kept when the chat goes
  chat_id bigint references reading_chats (id) on delete set null,
  notebook_id bigint references reading_notebooks (id) on delete set null, -- a notebook's note (kind free)
  suggested_at timestamptz, -- when links were last suggested; null: never
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'paper') = (paper_id is not null)),
  check ((kind = 'chat') = (chat is not null))
);
create unique index if not exists vault_notes_title on vault_notes (lower(title));
create unique index if not exists vault_notes_paper on vault_notes (paper_id) where paper_id is not null;
create unique index if not exists vault_notes_chat on vault_notes (chat_id) where chat_id is not null;
create unique index if not exists vault_notes_notebook on vault_notes (notebook_id) where notebook_id is not null;

-- Derived from bodies (setBody): one row per distinct [[target]] of a note, lowercased.
create table if not exists vault_links (
  from_id bigint not null references vault_notes (id) on delete cascade,
  target text not null,
  primary key (from_id, target)
);
create index if not exists vault_links_target on vault_links (target);

create table if not exists vault_suggestions (
  id bigserial primary key,
  note_id bigint not null references vault_notes (id) on delete cascade,
  target_id bigint references vault_notes (id) on delete cascade, -- null: a new concept note
  title text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open','accepted','dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists vault_suggestions_note on vault_suggestions (note_id);

-- Project 2's notes move in. vault_cut and vault_title are noteTitle and numberedTitle (vault-links.ts): code
-- points, explicit character classes (JS's \s and \p{Cc}), so the locale can't make them disagree.
create or replace function vault_cut(t text, k int) returns text language sql immutable as $$
  select btrim(case when octet_length(left(t, 100 - k)) > 200 - k then left(t, 50 - k) else left(t, 100 - k) end, ' .')
$$;
create or replace function vault_title(raw text) returns text language sql immutable as $$
  select coalesce(nullif(vault_cut(btrim(regexp_replace(
    regexp_replace(raw, '[\\/:*?"<>|#^\[\]\x01-\x1f\x7f-\x9f]', ' ', 'g'),
    '[ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' .'), 0), ''), 'Untitled')
$$;

-- ponytail: a duplicate's ' (2)' could meet a paper literally titled "X (2)" and fail the migration; vanishingly rare.
with saved_answer as (
  select * from reading_chats where role = 'assistant' and saved_at is not null
),
candidate as (
  -- Paper notes: saved, or written in, highlighted, asked about, or cited by a saved notebook answer.
  select 1 as ord, p.id, 'paper' as kind, p.title as raw, coalesce(n.body, '') as body, p.id as paper_id,
    null::bigint as chat_id, null::bigint as notebook_id, null::jsonb as chat, null::bigint as chat_paper,
    null::jsonb as cites
  from reading_papers p left join reading_notes n on n.paper_id = p.id
  where p.state = 'saved' or btrim(n.body) <> ''
    or exists (select 1 from reading_highlights h where h.paper_id = p.id)
    or exists (select 1 from saved_answer a where a.paper_id = p.id)
    or exists (select 1 from saved_answer a, jsonb_array_elements(a.cites) c
      where a.notebook_id is not null and (c->>'paper')::bigint = p.id)
  union all
  -- Chat notes: saved answers, titled by the question before them.
  select 2, a.id, 'chat', coalesce(q.body, ''), '', null, a.id, null,
    jsonb_build_object('question', coalesce(q.body, ''), 'answer', a.body, 'cites', a.cites,
      'askedAt', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    a.paper_id, case when a.notebook_id is not null then a.cites end
  from saved_answer a
  left join lateral (
    select u.body from reading_chats u
    where u.role = 'user' and u.id < a.id and u.paper_id is not distinct from a.paper_id
      and u.notebook_id is not distinct from a.notebook_id
    order by u.id desc limit 1
  ) q on true
  union all
  -- Notebook notes: kept as free notes.
  select 3, b.id, 'free', b.title, n.body, null, null, b.id, null, null, null
  from reading_notebooks b join reading_notes n on n.notebook_id = b.id
  where btrim(n.body) <> ''
),
numbered as (
  select *, vault_title(raw) as base, row_number() over (partition by lower(vault_title(raw)) order by ord, id) as n
  from candidate
),
titled as (
  select *, case when n = 1 then base else vault_cut(base, length(' (' || n || ')')) || ' (' || n || ')' end as title
  from numbered
)
insert into vault_notes (kind, title, body, paper_id, chat, chat_id, notebook_id)
select t.kind, t.title,
  case
    when t.chat_paper is not null then 'From [[' || (select p.title from titled p where p.paper_id = t.chat_paper) || ']]'
    when t.cites is not null then coalesce('From ' || (
      select string_agg('[[' || p.title || ']]', ', ' order by c.at)
      from (select (e->>'paper')::bigint as paper, min(i) as at
        from jsonb_array_elements(t.cites) with ordinality x(e, i) group by 1) c
      join titled p on p.paper_id = c.paper), '')
    else t.body
  end,
  t.paper_id, t.chat, t.chat_id, t.notebook_id
from titled t
order by t.ord, t.id;

-- wikiLinks' pattern; targets lowercased with whitespace runs collapsed.
insert into vault_links (from_id, target)
select distinct v.id, l.target
from vault_notes v, lateral (
  select lower(btrim(regexp_replace(m[1],
    '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))) as target
  from regexp_matches(v.body, '!?\[\[([^\][|#\n]+)(?:[#|][^\]\n]*)?\]\]', 'g') m
) l
where l.target <> '';

drop function vault_title(text);
drop function vault_cut(text, int);

-- The vault holds the notes now.
drop table reading_notes;
