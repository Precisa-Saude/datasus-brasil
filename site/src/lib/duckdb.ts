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

/**
 * Versão de `queryAll` que interna (`String.prototype.intern`-style)
 * todos os valores string das colunas indicadas, compartilhando uma
 * única instância de cada valor distinto via um Map por chamada.
 * Para datasets com alta repetição (município, UF, LOINC, competência
 * aparecendo milhões de vezes no resultado do detector de
 * atipicidades), corta o footprint heap em ~30-50% sem mudar o
 * shape do retorno — V8 mantém ponteiros pra strings já criadas em
 * vez de duplicar o conteúdo.
 *
 * Use só quando o ganho compensa: o pool de Maps é descartado ao
 * final, mas o trabalho de intern é desperdiçado em datasets
 * pequenos. Pra queries que retornam poucas linhas, prefira o
 * `queryAll` normal.
 */
export async function queryAllInterned<T extends object>(
  sql: string,
  internColumns: readonly (keyof T & string)[],
): Promise<T[]> {
  const conn = await getConn();
  const table = await conn.query(sql);
  const pools = new Map<string, Map<string, string>>();
  for (const col of internColumns) pools.set(col, new Map<string, string>());
  return table.toArray().map((row) => {
    const obj = row.toJSON() as Record<string, unknown>;
    for (const col of internColumns) {
      const raw = obj[col];
      if (typeof raw !== 'string') continue;
      const pool = pools.get(col)!;
      const existing = pool.get(raw);
      if (existing === undefined) {
        pool.set(raw, raw);
      } else {
        obj[col] = existing;
      }
    }
    return obj as T;
  });
}

/**
 * Fecha conexão e termina o worker do DuckDB-WASM. Usado após
 * materializar um dataset grande (modo "Todos os Estados" do
 * explorador) pra devolver a memória do pool interno do DuckDB ao
 * sistema — o pool guarda parquets descomprimidos como cache e não
 * libera agressivamente. A próxima chamada a `queryAll` reinicia DB +
 * worker (~100ms; bundle WASM já está cacheado pelo browser).
 */
export async function resetDuckDB(): Promise<void> {
  if (connPromise !== null) {
    const c = connPromise;
    connPromise = null;
    try {
      const conn = await c;
      await conn.close();
    } catch {
      // pode já estar fechado / desconectado — ignora
    }
  }
  if (dbPromise !== null) {
    const p = dbPromise;
    dbPromise = null;
    try {
      const db = await p;
      await db.terminate();
    } catch {
      // worker pode já estar terminado — ignora
    }
  }
}
