import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Sql, Tx } from './db';

/** Tests: an in-process Postgres behind the postgres.js surface the app uses (see Sql). */
export function pgliteSql(db: PGlite = new PGlite()): Sql {
  const sql = queries(db) as Sql;
  sql.begin = (fn) => db.transaction((tx) => fn(queries(tx)));
  return sql;
}

/** A transaction's handle, like postgres.js 3.4.9's: queries and unsafe, no begin. */
function queries(db: PGlite | Transaction): Tx {
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, s, i) => `${out}$${i}${s}`);
    return (await db.query(text, values)).rows;
  }) as Tx;
  q.unsafe = (query) => db.exec(query);
  return q;
}
