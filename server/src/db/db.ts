/**
 * A tiny database interface with two implementations:
 *  - PostgreSQL via `pg` (production: set DATABASE_URL)
 *  - PGlite, an embedded Postgres, for local use without installing anything and for tests.
 * Both speak the same SQL, so the rest of the server doesn't care which one runs.
 */
import pg from 'pg';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

type Querier = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

function wrap(q: Querier, tx: Db['tx'], exec: Db['exec'], close: Db['close']): Db {
  const query = async <T>(sql: string, params: unknown[] = []) => (await q.query(sql, params)).rows as T[];
  return { query, one: async (s, p) => (await query(s, p))[0] as never, tx, exec, close };
}

export async function connectPostgres(url: string, ssl: boolean): Promise<Db> {
  // Return DATE columns as plain 'YYYY-MM-DD' strings.
  pg.types.setTypeParser(1082, (v: string) => v);
  const pool = new pg.Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 10 });
  const db: Db = wrap(
    pool,
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inner = wrap(client, () => { throw new Error('Nested transactions are not supported'); }, async (s) => { await client.query(s); }, async () => undefined);
        const result = await fn(inner);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async (s) => { await pool.query(s); },
    async () => { await pool.end(); },
  );
  await pool.query('select 1');
  return db;
}

export async function connectPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(dir);
  await lite.waitReady;
  // 1082 = DATE: keep as 'YYYY-MM-DD' (same as the pg driver setup above).
  const opts = { parsers: { 1082: (v: string) => v } };
  type Lite = { query: (s: string, p?: unknown[], o?: unknown) => Promise<{ rows: unknown[] }> };
  const q = (x: Lite): Querier => ({ query: (s, p) => x.query(s, p, opts) });
  const db: Db = wrap(
    q(lite as unknown as Lite),
    (fn) => lite.transaction(async (t) => fn(wrap(q(t as unknown as Lite), () => { throw new Error('Nested transactions are not supported'); }, async (s) => { await t.exec(s); }, async () => undefined))),
    async (s) => { await lite.exec(s); },
    async () => { await lite.close(); },
  );
  return db;
}

/** Serialise a value for a jsonb parameter (use with `$n::jsonb`). */
export const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

/** Timestamps come back as Date objects; the API speaks ISO strings. */
export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
export const isoOpt = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : iso(v));
