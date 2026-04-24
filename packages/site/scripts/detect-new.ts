#!/usr/bin/env tsx
/**
 * Sonda o FTP do DATASUS listando `PA*.dbc` em
 * `/dissemin/publicos/SIASUS/200801_/Dados/` e compara com
 * `state/dataset.json` para detectar competências novas ou
 * modificadas. Emite `state/pending.json` com o delta.
 *
 * Escrito pra rodar em GH Actions:
 *   - exit 0 sempre (sucesso, mesmo se nada a fazer)
 *   - escreve `hasNew` e `latestCompetencia` em $GITHUB_OUTPUT
 *     (se definido)
 *
 * Uso local:
 *   pnpm -F @datasus-brasil/site run detect-new
 *   pnpm -F @datasus-brasil/site run detect-new -- --state state/dataset.json
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'basic-ftp';

const FTP_HOST = 'ftp.datasus.gov.br';
const FTP_DIR = '/dissemin/publicos/SIASUS/200801_/Dados';

interface Cli {
  markProcessed: boolean;
  outPending: string;
  stateFile: string;
}

interface StateEntry {
  sha256?: string;
  sourceMtime: string;
  sourceSize: number;
}

interface State {
  lastRun: string;
  processed: Record<string, Record<string, StateEntry>>;
  schemaVersion: number;
}

interface PendingEntry {
  ftpMtime: string;
  ftpPath: string;
  ftpSize: number;
  month: number;
  uf: string;
  year: number;
}

interface PendingFile {
  detectedAt: string;
  latestCompetencia: null | string;
  pending: PendingEntry[];
}

function parseArgs(argv: string[]): Cli {
  const get = (flag: string, fallback: string): string => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return fallback;
    const value = argv[idx + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Valor ausente para ${flag}`);
    }
    return value;
  };
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)), '..', '..');
  return {
    markProcessed: argv.includes('--mark-processed'),
    outPending: resolve(repoRoot, get('--out', 'state/pending.json')),
    stateFile: resolve(repoRoot, get('--state', 'state/dataset.json')),
  };
}

function loadState(path: string): State {
  if (!existsSync(path)) {
    return { lastRun: '', processed: {}, schemaVersion: 1 };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as State;
}

const FILE_RE = /^PA([A-Z]{2})(\d{2})(\d{2})\.dbc$/i;

interface ParsedFtpName {
  competencia: string;
  month: number;
  uf: string;
  year: number;
}

function parseFtpName(name: string): null | ParsedFtpName {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  const uf = m[1]!.toUpperCase();
  const yy = Number(m[2]);
  const month = Number(m[3]);
  if (month < 1 || month > 12) return null;
  // SIA começa em 2008; janelas de 2-dígitos viram 20YY.
  const year = 2000 + yy;
  return { competencia: `${year}-${String(month).padStart(2, '0')}`, month, uf, year };
}

async function listRemote(): Promise<Array<{ mtime: Date; name: string; size: number }>> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access({ host: FTP_HOST, port: 21, secure: false });
    const entries = await client.list(FTP_DIR);
    return entries
      .filter((e) => e.type === 1 && e.name.toUpperCase().endsWith('.DBC'))
      .map((e) => ({ mtime: e.modifiedAt ?? new Date(0), name: e.name, size: e.size }));
  } finally {
    client.close();
  }
}

function computeDelta(
  remote: Array<{ mtime: Date; name: string; size: number }>,
  state: State,
): PendingEntry[] {
  const out: PendingEntry[] = [];
  for (const entry of remote) {
    const parsed = parseFtpName(entry.name);
    if (!parsed) continue;
    // SP tem split files `PASP{YY}{MM}{a,b,c}.dbc` — ignorados por
    // enquanto (core não suporta). Outros UFs caem no regex padrão.
    const known = state.processed[parsed.uf]?.[parsed.competencia];
    const changed =
      !known ||
      known.sourceSize !== entry.size ||
      new Date(known.sourceMtime).getTime() !== entry.mtime.getTime();
    if (!changed) continue;
    out.push({
      ftpMtime: entry.mtime.toISOString(),
      ftpPath: `${FTP_DIR}/${entry.name}`,
      ftpSize: entry.size,
      month: parsed.month,
      uf: parsed.uf,
      year: parsed.year,
    });
  }
  // Determinismo.
  return out.sort((a, b) => {
    if (a.uf !== b.uf) return a.uf.localeCompare(b.uf);
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
}

function setGhOutput(key: string, value: string): void {
  const file = process.env['GITHUB_OUTPUT'];
  if (!file) return;
  appendFileSync(file, `${key}=${value}\n`);
}

function markProcessed(cli: Cli): void {
  // Lê pending.json + merge no state/dataset.json. Chamado após
  // aggregate --from-pending rodar com sucesso.
  if (!existsSync(cli.outPending)) {
    throw new Error(`--mark-processed requer ${cli.outPending} existente.`);
  }
  const pending = JSON.parse(readFileSync(cli.outPending, 'utf8')) as PendingFile;
  const state = loadState(cli.stateFile);
  for (const entry of pending.pending) {
    const bucket = state.processed[entry.uf] ?? {};
    const competencia = `${entry.year}-${String(entry.month).padStart(2, '0')}`;
    bucket[competencia] = {
      sourceMtime: entry.ftpMtime,
      sourceSize: entry.ftpSize,
    };
    state.processed[entry.uf] = bucket;
  }
  state.lastRun = new Date().toISOString();
  mkdirSync(dirname(cli.stateFile), { recursive: true });
  writeFileSync(cli.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  process.stderr.write(
    `✓ state atualizado: ${pending.pending.length} entradas merged em ${cli.stateFile}\n`,
  );
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.markProcessed) {
    markProcessed(cli);
    return;
  }
  const state = loadState(cli.stateFile);
  process.stderr.write(
    `Sondando ${FTP_HOST}${FTP_DIR}… (state conhece ${Object.keys(state.processed).length} UFs)\n`,
  );
  const remote = await listRemote();
  process.stderr.write(`${remote.length} arquivos no FTP\n`);

  const pending = computeDelta(remote, state);
  const latestCompetencia =
    pending.length === 0
      ? null
      : pending.reduce(
          (latest, p) => {
            const c = `${p.year}-${String(p.month).padStart(2, '0')}`;
            return !latest || c > latest ? c : latest;
          },
          null as null | string,
        );

  const out: PendingFile = {
    detectedAt: new Date().toISOString(),
    latestCompetencia,
    pending,
  };

  mkdirSync(dirname(cli.outPending), { recursive: true });
  writeFileSync(cli.outPending, `${JSON.stringify(out, null, 2)}\n`);

  process.stderr.write(
    `${pending.length} competências pendentes${
      latestCompetencia ? ` (mais recente: ${latestCompetencia})` : ''
    }\n`,
  );
  setGhOutput('hasNew', pending.length > 0 ? 'true' : 'false');
  setGhOutput('pendingCount', String(pending.length));
  if (latestCompetencia) setGhOutput('latestCompetencia', latestCompetencia);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Erro: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
