/**
 * DuckDB WASM singleton — bundle local via Vite `?url` em vez do
 * jsDelivr default. Evita CORS / Trusted-Types quirks em
 * cross-origin Blob workers.
 *
 * O banco é em memória; as tabelas-base vivem em S3 como Parquet e
 * são acessadas via `read_parquet('https://.../*.parquet')` direto
 * dentro da query SQL.
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_eh_wasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdb_mvp_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';

const BUNDLES: duckdb.DuckDBBundles = {
  eh: { mainModule: duckdb_eh_wasm, mainWorker: eh_worker },
  mvp: { mainModule: duckdb_mvp_wasm, mainWorker: mvp_worker },
};

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

async function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(BUNDLES);
      const worker = new Worker(bundle.mainWorker!, { type: 'module' });
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
      // `httpfs` é nativo no bundle WASM atual — não precisa INSTALL/LOAD.
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
