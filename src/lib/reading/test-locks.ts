import type { Sql, Tx } from '../db';

export interface BodyWrite {
  /** The write ran holding the vault's title lock. */
  titleLock: boolean;
  /** The notes its transaction had row-locked (for update) and not yet rewritten, by id. */
  locked: number[];
}

/**
 * Tests: `sql` that, just before each vault body write, records what its transaction holds. pglite has one
 * connection, so two transactions can't interleave; this checks the locks that keep them apart under postgres.
 * Lives outside a .test.ts so importing it doesn't rerun a test file.
 */
export function lockProbe(sql: Sql): { sql: Sql; writes: BodyWrite[] } {
  const writes: BodyWrite[] = [];
  const probed = probe(sql, 'update vault_notes set body', async (tx) => {
    const [r] = await tx<{ title_lock: boolean; locked: string[] | null }>`
      select exists (
          select 1 from pg_locks where locktype = 'advisory' and objid = 4207 and pid = pg_backend_pid()
        ) as title_lock,
        (select array_agg(id order by id) from vault_notes
          where xmax = xid(pg_current_xact_id_if_assigned())) as locked`;
    writes.push({ titleLock: r.title_lock, locked: (r.locked ?? []).map(Number) });
  });
  return { sql: probed, writes };
}

/** As lockProbe, before each highlight's public write: the highlights its transaction had row-locked, by id. */
export function highlightLockProbe(sql: Sql): { sql: Sql; writes: number[][] } {
  const writes: number[][] = [];
  const probed = probe(sql, 'update reading_highlights set public', async (tx) => {
    const [r] = await tx<{ locked: string[] | null }>`
      select array_agg(id order by id) as locked from reading_highlights
      where xmax = xid(pg_current_xact_id_if_assigned())`;
    writes.push((r.locked ?? []).map(Number));
  });
  return { sql: probed, writes };
}

/** `sql` that runs `before` in the same transaction just before each query containing `write`. */
function probe(sql: Sql, write: string, before: (tx: Tx) => Promise<void>): Sql {
  const wrap = (tx: Tx): Tx => {
    const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('').includes(write)) await before(tx);
      return tx(strings, ...values);
    }) as Tx;
    q.unsafe = (query) => tx.unsafe(query);
    return q;
  };
  const probed = wrap(sql) as Sql;
  probed.begin = (fn) => sql.begin((tx) => fn(wrap(tx)));
  return probed;
}
