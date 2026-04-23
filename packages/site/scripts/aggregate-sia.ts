#!/usr/bin/env tsx
/**
 * Agregador SIA-PA → JSONs pré-computados para o site.
 *
 * Baixa SIA-PA (via cache FTP do @precisa-saude/datasus), filtra
 * laboratório (SIGTAP 02.02), enriquece com LOINC e emite três
 * artefatos em `packages/site/public/data/`:
 *
 *   sia-pa-index.json      — biomarcadores e competências cobertas
 *   sia-pa-uf.json         — um registro por UF × LOINC × competência
 *   sia-pa-{UF}-municipios.json — um registro por município × LOINC × competência
 *
 * Uso:
 *   pnpm tsx scripts/aggregate-sia.ts --ufs AC --months 2024-01..2024-01
 *   pnpm tsx scripts/aggregate-sia.ts --ufs AC,RR --months 2024-01..2024-12
 *
 * Argumentos:
 *   --ufs     Lista separada por vírgula (ex: AC,RR,AP). Default: AC.
 *   --months  Range ISO `YYYY-MM..YYYY-MM`. Default: 2024-01..2024-01.
 *   --out     Diretório de saída. Default: packages/site/public/data.
 *
 * Observação operacional: o FTP cache está em `~/.cache/datasus-brasil`
 * por default; execuções subsequentes com os mesmos UF × mês batem
 * cache e não refazem download.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  enrichWithLoinc,
  findMunicipio,
  isSigtapLaboratorio,
  sia,
  type SiaProducaoAmbulatorialRecord,
} from '@precisa-saude/datasus';

interface Cli {
  months: Array<{ month: number; year: number }>;
  outDir: string;
  ufs: string[];
}

interface UfKey {
  competencia: string;
  loinc: string;
  ufSigla: string;
}

interface Accumulator {
  valorAprovadoBRL: number;
  volumeExames: number;
}

const UF_TO_CODE: Record<string, string> = {
  AC: '12',
  AL: '27',
  AM: '13',
  AP: '16',
  BA: '29',
  CE: '23',
  DF: '53',
  ES: '32',
  GO: '52',
  MA: '21',
  MG: '31',
  MS: '50',
  MT: '51',
  PA: '15',
  PB: '25',
  PE: '26',
  PI: '22',
  PR: '41',
  RJ: '33',
  RN: '24',
  RO: '11',
  RR: '14',
  RS: '43',
  SC: '42',
  SE: '28',
  SP: '35',
  TO: '17',
};

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

  const ufs = get('--ufs', 'AC')
    .split(',')
    .map((s) => s.trim().toUpperCase());
  const monthsRange = get('--months', '2024-01..2024-01');
  const [startISO, endISO] = monthsRange.split('..');
  if (!startISO || !endISO)
    throw new Error(`--months deve ser 'YYYY-MM..YYYY-MM', recebido '${monthsRange}'`);
  const months = expandMonths(startISO, endISO);
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const outDir = resolve(siteRoot, get('--out', 'public/data'));
  return { months, outDir, ufs };
}

function expandMonths(startISO: string, endISO: string): Array<{ month: number; year: number }> {
  const parse = (iso: string): { month: number; year: number } => {
    const [y, m] = iso.split('-');
    if (!y || !m) throw new Error(`Competência inválida: '${iso}'`);
    return { month: Number(m), year: Number(y) };
  };
  const start = parse(startISO);
  const end = parse(endISO);
  const out: Array<{ month: number; year: number }> = [];
  let { month, year } = start;
  while (year < end.year || (year === end.year && month <= end.month)) {
    out.push({ month, year });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function competenciaIso(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

async function processFile(
  ufSigla: string,
  year: number,
  month: number,
  ufAcc: Map<string, Accumulator>,
  munAcc: Map<string, Accumulator & { municipioNome: string }>,
  biomarkers: Map<string, { code: string; display: string; loinc: string }>,
): Promise<number> {
  const iso = competenciaIso(year, month);
  let processed = 0;
  for await (const raw of sia.streamProducaoAmbulatorial({ month, uf: ufSigla, year })) {
    processed += 1;
    const record = raw as SiaProducaoAmbulatorialRecord;
    if (!isSigtapLaboratorio(typeof record.PA_PROC_ID === 'string' ? record.PA_PROC_ID : null)) {
      continue;
    }
    const enriched = enrichWithLoinc(record);
    if (enriched.loinc === null || enriched.loinc.loinc === null) continue;

    const loinc = enriched.loinc.loinc;
    if (!biomarkers.has(loinc)) {
      biomarkers.set(loinc, {
        code: enriched.loinc.biomarker.code,
        display: enriched.loinc.biomarker.display,
        loinc,
      });
    }

    const qtd = typeof record.PA_QTDAPR === 'number' ? record.PA_QTDAPR : 1;
    const valor = typeof record.PA_VALAPR === 'number' ? record.PA_VALAPR : 0;

    const ufKey: UfKey = { competencia: iso, loinc, ufSigla };
    const ufId = `${ufKey.ufSigla}|${ufKey.loinc}|${ufKey.competencia}`;
    const ufCurrent = ufAcc.get(ufId) ?? { valorAprovadoBRL: 0, volumeExames: 0 };
    ufCurrent.volumeExames += qtd;
    ufCurrent.valorAprovadoBRL += valor;
    ufAcc.set(ufId, ufCurrent);

    const munCode = typeof record.PA_UFMUN === 'string' ? record.PA_UFMUN : null;
    if (munCode !== null) {
      const munInfo = findMunicipio(munCode);
      const munId = `${ufSigla}|${munCode}|${loinc}|${iso}`;
      const munCurrent = munAcc.get(munId) ?? {
        municipioNome: munInfo?.nome ?? munCode,
        valorAprovadoBRL: 0,
        volumeExames: 0,
      };
      munCurrent.volumeExames += qtd;
      munCurrent.valorAprovadoBRL += valor;
      munAcc.set(munId, munCurrent);
    }
  }
  return processed;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.outDir, { recursive: true });
  process.stderr.write(
    `Agregando SIA-PA | UFs=${cli.ufs.join(',')} | ${cli.months.length} meses | out=${cli.outDir}\n`,
  );

  const biomarkers = new Map<string, { code: string; display: string; loinc: string }>();
  const ufAcc = new Map<string, Accumulator>();
  const munByUf = new Map<string, Map<string, Accumulator & { municipioNome: string }>>();

  for (const ufSigla of cli.ufs) {
    if (!UF_TO_CODE[ufSigla]) {
      process.stderr.write(`Pulando UF inválida: ${ufSigla}\n`);
      continue;
    }
    const munAcc = munByUf.get(ufSigla) ?? new Map();
    munByUf.set(ufSigla, munAcc);
    for (const { month, year } of cli.months) {
      process.stderr.write(`  ${ufSigla} ${year}-${String(month).padStart(2, '0')}... `);
      try {
        const n = await processFile(ufSigla, year, month, ufAcc, munAcc, biomarkers);
        process.stderr.write(`${n} registros\n`);
      } catch (err) {
        process.stderr.write(`FALHOU: ${(err as Error).message}\n`);
      }
    }
  }

  const competenciasSet = new Set<string>();
  const ufOut: Array<Record<string, unknown>> = [];
  for (const [id, acc] of ufAcc) {
    const [ufSigla, loinc, competencia] = id.split('|') as [string, string, string];
    competenciasSet.add(competencia);
    ufOut.push({
      competencia,
      loinc,
      ufCode: UF_TO_CODE[ufSigla],
      ufSigla,
      valorAprovadoBRL: Number(acc.valorAprovadoBRL.toFixed(2)),
      volumeExames: acc.volumeExames,
    });
  }
  ufOut.sort((a, b) => String(a.ufSigla).localeCompare(String(b.ufSigla)));

  const availableUFs = Array.from(munByUf.entries())
    .filter(([, acc]) => acc.size > 0)
    .map(([uf]) => uf)
    .sort();

  const indexOut = {
    availableUFs,
    biomarkers: Array.from(biomarkers.values()).sort((a, b) => a.display.localeCompare(b.display)),
    competencias: Array.from(competenciasSet).sort(),
    geradoEm: new Date().toISOString(),
    year: cli.months[0]?.year ?? new Date().getFullYear(),
  };

  writeFileSync(resolve(cli.outDir, 'sia-pa-index.json'), `${JSON.stringify(indexOut, null, 2)}\n`);
  writeFileSync(resolve(cli.outDir, 'sia-pa-uf.json'), `${JSON.stringify(ufOut, null, 2)}\n`);
  process.stderr.write(`Escrito ${ufOut.length} linhas UF × LOINC × mês em sia-pa-uf.json\n`);

  for (const [ufSigla, munAcc] of munByUf) {
    if (munAcc.size === 0) continue;
    const rows: Array<Record<string, unknown>> = [];
    for (const [id, acc] of munAcc) {
      const parts = id.split('|') as [string, string, string, string];
      rows.push({
        competencia: parts[3],
        loinc: parts[2],
        municipioCode: parts[1],
        municipioNome: acc.municipioNome,
        valorAprovadoBRL: Number(acc.valorAprovadoBRL.toFixed(2)),
        volumeExames: acc.volumeExames,
      });
    }
    rows.sort((a, b) => String(a.municipioNome).localeCompare(String(b.municipioNome)));
    writeFileSync(
      resolve(cli.outDir, `sia-pa-${ufSigla}-municipios.json`),
      `${JSON.stringify(rows, null, 2)}\n`,
    );
    process.stderr.write(`Escrito ${rows.length} linhas em sia-pa-${ufSigla}-municipios.json\n`);
  }

  process.stderr.write(`✓ Agregação completa. Arquivos em ${cli.outDir}\n`);
  // Força exit pra evitar vazamento de handle FTP mantendo o processo vivo.
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Erro: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
