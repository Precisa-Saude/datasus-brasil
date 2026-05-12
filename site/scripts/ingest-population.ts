/**
 * Baixa estimativas anuais de população por município do IBGE (SIDRA
 * agregado 6579, variável 9324) e materializa em
 * `site/public/data/populacao.json`.
 *
 * Fonte: IBGE — Estimativas da População dos Municípios, série
 * histórica.
 *   https://servicodados.ibge.gov.br/api/v3/agregados/6579
 * Tabela publicada em
 *   https://www.ibge.gov.br/estatisticas/sociais/populacao/9103-estimativas-de-populacao.html
 *
 * Cobertura: a SIDRA expõe 2001+ pra agregado 6579 — pegamos a janela
 * que cobre a série SIA-PA do site (2008–presente).
 *
 * Saída:
 *   {
 *     source: "...",
 *     generatedAt: "ISO-8601",
 *     coverageYears: [2008, ..., 2024],
 *     population: { "350000": { "2008": 12345, ..., "2024": 13456 }, ... }
 *   }
 *
 * Uso:
 *   pnpm -F @datasus-viz/site exec tsx scripts/ingest-population.ts
 *
 * Idempotente — sobrescreve o arquivo. Rodar 1× ao ano após o IBGE
 * publicar a nova estimativa.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUTPUT_PATH = join(SITE_ROOT, 'public', 'data', 'populacao.json');

// SIDRA: agregado=6579 (estimativas), variável=9324 (população residente),
// localidades=N6[all] (todos os municípios). A série tem buracos (2007,
// 2010, 2022, 2023 — anos de censo ou de não-publicação), então
// consultamos o endpoint de períodos antes de montar a URL final pra
// não estourar 500 com years inválidos.
const START_YEAR = 2008;
const PERIODS_URL = 'https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos';
const buildSidraUrl = (periods: string): string =>
  `https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/${periods}/variaveis/9324?localidades=N6[all]`;

interface SidraResponse {
  resultados: Array<{
    series: Array<{
      localidade: { id: string; nome: string };
      serie: Record<string, string>;
    }>;
  }>;
  variavel: string;
}

interface PopulationOutput {
  coverageYears: number[];
  generatedAt: string;
  population: Record<string, Record<string, number>>;
  source: string;
}

interface SidraPeriod {
  id: string;
}

async function main(): Promise<void> {
  console.log(`Discovering available periods: ${PERIODS_URL}`);
  const periodsRes = await fetch(PERIODS_URL);
  if (!periodsRes.ok) {
    throw new Error(`SIDRA /periodos respondeu ${periodsRes.status}`);
  }
  const periods = (await periodsRes.json()) as SidraPeriod[];
  const wantedYears = periods
    .map((p) => Number(p.id))
    .filter((y) => Number.isFinite(y) && y >= START_YEAR)
    .sort((a, b) => a - b);
  if (wantedYears.length === 0) {
    throw new Error('Nenhum período válido retornado pelo SIDRA.');
  }
  console.log(`Fetching ${wantedYears.length} anos (${wantedYears[0]}–${wantedYears.at(-1)})`);
  const population: Record<string, Record<string, number>> = {};
  const yearsSet = new Set<number>();

  // Buscamos ano-a-ano: SIDRA dá 500 quando a query agrega muitos
  // municípios × muitos períodos numa só request. Um ano de cada vez
  // é seguro e leva poucos segundos no total. Retry com backoff
  // porque o SIDRA fecha socket de vez em quando em payloads grandes.
  const fetchWithRetry = async (url: string, label: string): Promise<SidraResponse[]> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()) as SidraResponse[];
      } catch (e) {
        lastErr = e;
        const waitMs = 500 * attempt;
        console.warn(
          `  ${label}: tentativa ${attempt} falhou (${String(e).slice(0, 80)}…), retry em ${waitMs}ms`,
        );
        await new Promise((res) => setTimeout(res, waitMs));
      }
    }
    throw lastErr;
  };

  for (const year of wantedYears) {
    const raw = await fetchWithRetry(buildSidraUrl(String(year)), `ano ${year}`);
    const series = raw[0]?.resultados[0]?.series ?? [];
    if (series.length === 0) {
      console.warn(`Ano ${year}: sem séries (pulando)`);
      continue;
    }
    let yearCount = 0;
    for (const s of series) {
      const code = s.localidade.id;
      if (!code) continue;
      const value = s.serie[String(year)];
      if (value === undefined || value === '...' || value === '-' || value === '') continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) continue;
      // SIDRA devolve códigos IBGE de 7 dígitos (com dígito verificador).
      // O parquet do projeto (e o resto do DATASUS) usa o código de 6
      // dígitos — o dígito verificador é dropado. Normalizamos pra 6
      // aqui pra evitar lookup falhando no client.
      const code6 = code.slice(0, 6);
      population[code6] ??= {};
      population[code6]![String(year)] = n;
      yearCount++;
    }
    if (yearCount > 0) yearsSet.add(year);
    console.log(`  ${year}: ${yearCount} municípios`);
  }

  const coverageYears = [...yearsSet].sort((a, b) => a - b);

  const output: PopulationOutput = {
    coverageYears,
    generatedAt: new Date().toISOString(),
    population,
    source: `IBGE — Estimativas da População dos Municípios. SIDRA agregado 6579, variável 9324.`,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output), 'utf-8');

  const sizeKb = (JSON.stringify(output).length / 1024).toFixed(1);
  console.log(
    `OK — ${Object.keys(population).length} municípios × ${coverageYears.length} anos (${coverageYears[0]}–${coverageYears.at(-1)}). ${sizeKb} KB em ${OUTPUT_PATH}`,
  );
}

main().catch((e) => {
  console.error('Falha:', e);
  process.exit(1);
});
