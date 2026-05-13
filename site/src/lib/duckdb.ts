/**
 * DuckDB WASM singleton — bundles carregados de jsDelivr CDN em vez
 * de bundled localmente. Bundled-local cresce dist > 25 MB e excede
 * o limite do Cloudflare Pages por arquivo. CDN também permite cache
 * compartilhado entre projetos.
 *
 * Worker cross-origin é resolvido envolvendo o script CDN num Blob URL
 * (mesmo padrão do `getJsDelivrBundles()` upstream).
 *
 * O banco é em memória; as tabelas-base vivem em S3 como Parquet e
 * são acessadas via `read_parquet('https://.../*.parquet')` direto
 * dentro da query SQL.
 */

import * as duckdb from '@duckdb/duckdb-wasm';

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

async function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(BUNDLES);
      // Cross-origin worker via Blob URL (padrão DuckDB-wasm).
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker!}");`], {
          type: 'text/javascript',
        }),
      );
      const worker = new Worker(workerUrl);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
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
