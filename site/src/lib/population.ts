/**
 * Loader das estimativas de população do IBGE — carrega o JSON
 * estático em `public/data/populacao.json` (gerado por
 * `scripts/ingest-population.ts`) e expõe uma função de lookup
 * `(municipioCode, year) => populacao | undefined`.
 *
 * A SIDRA tem buracos na série (2007, 2010, 2022, 2023 — anos de
 * censo ou não-publicação). Pra qualquer competência num ano sem
 * publicação direta, o lookup faz fallback para o ano mais próximo
 * disponível dentro do mesmo município. Mantém o sinal de per-capita
 * útil sem ter que esperar o IBGE preencher os buracos.
 *
 * Singleton: o JSON é fetched uma vez e cacheado em memória — o
 * caller usa o mesmo `PopulationLookup` em todos os detectores.
 */

import type { PopulationLookup } from './anomaly';

interface PopulationData {
  coverageYears: number[];
  generatedAt: string;
  /** `{ '431060': { '2018': 37757, ... }, ... }` — código IBGE 6 dígitos. */
  population: Record<string, Record<string, number>>;
  source: string;
}

export interface PopulationDataset {
  coverageYears: number[];
  lookup: PopulationLookup;
  source: string;
}

let cache: null | Promise<PopulationDataset> = null;

const POPULATION_URL = '/data/populacao.json';

/**
 * Constrói a função de lookup com fallback por ano mais próximo.
 *
 * `coverageYears` está pré-ordenado ascendente. Pra `year`
 * solicitado fora do range, retorna o ano mais perto disponível
 * **pra aquele município**. Anos faltantes globalmente nem aparecem
 * no map; anos faltantes só por município (raro) também não.
 */
function buildLookup(data: PopulationData): PopulationLookup {
  const fallbackCache = new Map<string, Record<string, number>>();
  return (municipioCode, year) => {
    const byYear = data.population[municipioCode] ?? fallbackCache.get(municipioCode);
    if (!byYear) return undefined;
    fallbackCache.set(municipioCode, byYear);
    const exact = byYear[String(year)];
    if (exact !== undefined) return exact;
    // Procura o ano publicado mais próximo (em valor absoluto) pra
    // este município. Lista de anos disponíveis específica do
    // município — caso algum tenha lacunas só nele.
    const muniYears = Object.keys(byYear).map(Number);
    if (muniYears.length === 0) return undefined;
    let best: number = muniYears[0]!;
    let bestDist = Math.abs(year - best);
    for (let i = 1; i < muniYears.length; i++) {
      const y = muniYears[i]!;
      const d = Math.abs(year - y);
      if (d < bestDist) {
        best = y;
        bestDist = d;
      }
    }
    return byYear[String(best)];
  };
}

/**
 * Carrega (lazy) o dataset de população do IBGE. Cacheia a promessa,
 * então múltiplas chamadas concorrentes compartilham o mesmo fetch.
 */
export function loadPopulation(): Promise<PopulationDataset> {
  if (cache) return cache;
  cache = (async () => {
    const res = await fetch(POPULATION_URL);
    if (!res.ok) {
      throw new Error(
        `Falha ao carregar população (${res.status}). Rode \`pnpm -F @datasus-viz/site exec tsx scripts/ingest-population.ts\` pra gerar o arquivo.`,
      );
    }
    const data = (await res.json()) as PopulationData;
    return {
      coverageYears: data.coverageYears,
      lookup: buildLookup(data),
      source: data.source,
    };
  })();
  return cache;
}

/** Hook de teste — limpa o cache singleton entre testes. */
export function __resetPopulationCacheForTests(): void {
  cache = null;
}
