/**
 * DuckDB WASM singleton — bootstrap lazy, conexão única, queries via
 * `queryAll`. Usa bundler-side worker do próprio `@duckdb/duckdb-wasm`
 * pra evitar CORS gymnastics com CDN remoto.
 *
 * O banco é em memória; as tabelas-base vivem em S3 como Parquet e
 * são acessadas via `read_parquet('https://.../*.parquet',
 * hive_partitioning=1)` direto dentro da query SQL. Pushdown de
 * filtro por partição (`WHERE ano=..., uf=...`) evita baixar a
 * massa inteira — só os Parquets relevantes viram HTTP Range
 * requests.
 */

import * as duckdb from '@duckdb/duckdb-wasm';

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

async function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);
      const workerBlob = new Blob([`importScripts("${bundle.mainWorker!}");`], {
        type: 'application/javascript',
      });
      const worker = new Worker(URL.createObjectURL(workerBlob));
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      return db;
    })();
  }
  return dbPromise;
}

async function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    connPromise = (async () => {
      const db = await getDb();
      const conn = await db.connect();
      // Habilita httpfs pra ler Parquet direto de URLs remotas.
      await conn.query(`INSTALL httpfs; LOAD httpfs;`);
      return conn;
    })();
  }
  return connPromise;
}

/** Roda SELECT e materializa em array de objetos JS. */
export async function queryAll<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getConn();
  const table = await conn.query(sql);
  return table.toArray().map((row) => row.toJSON() as T);
}
