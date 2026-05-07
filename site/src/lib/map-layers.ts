/**
 * Funções puras de configuração/atualização de layers do MapLibre
 * para o choropleth Brasil + drill-down UF. Extraído do
 * `BrasilMap.tsx` só pra manter o componente dentro do limite de
 * linhas — contém zero estado React.
 */

import type maplibregl from 'maplibre-gl';

import type { BinTotals } from './data-cube';
import { PMTILES_URL } from './data-source';

export const SOURCE_ID = 'brasil';
export const UF_LAYER = 'ufs';
export const MUN_LAYER = 'municipios';
export const UF_FILL = 'uf-fill';
export const UF_OUTLINE = 'uf-outline';
export const MUN_FILL = 'municipios-fill';
export const MUN_OUTLINE = 'municipios-outline';

const VIOLET_RAMP = [
  'interpolate',
  ['linear'],
  ['coalesce', ['feature-state', 'normalizado'], 0],
  0,
  '#f3f0ff',
  0.25,
  '#c7b8ff',
  0.5,
  '#7856d2',
  0.75,
  '#463c6d',
  1,
  '#2a2241',
];

export function addMapLayers(map: maplibregl.Map): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      promoteId: { municipios: 'codarea', ufs: 'sigla' },
      type: 'vector',
      url: `pmtiles://${PMTILES_URL}`,
    });
  }
  if (!map.getLayer(UF_FILL)) {
    map.addLayer({
      id: UF_FILL,
      paint: {
        'fill-color': VIOLET_RAMP as unknown as maplibregl.ExpressionSpecification,
        'fill-opacity': 0.75,
      },
      source: SOURCE_ID,
      'source-layer': UF_LAYER,
      type: 'fill',
    });
    map.addLayer({
      id: UF_OUTLINE,
      paint: { 'line-color': '#463c6d', 'line-width': 0.5 },
      source: SOURCE_ID,
      'source-layer': UF_LAYER,
      type: 'line',
    });
  }
  if (!map.getLayer(MUN_FILL)) {
    // visibility hidden por default: caso contrário a layer fica acima
    // do UF_FILL com fill-opacity 0 e captura cliques destinados ao UF.
    map.addLayer({
      id: MUN_FILL,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': VIOLET_RAMP as unknown as maplibregl.ExpressionSpecification,
        'fill-opacity': [
          'case',
          ['>', ['coalesce', ['feature-state', 'volume'], 0], 0],
          0.75,
          0,
        ] as unknown as maplibregl.ExpressionSpecification,
      },
      source: SOURCE_ID,
      'source-layer': MUN_LAYER,
      type: 'fill',
    });
    map.addLayer({
      id: MUN_OUTLINE,
      layout: { visibility: 'none' },
      paint: { 'line-color': '#463c6d', 'line-width': 0.4 },
      source: SOURCE_ID,
      'source-layer': MUN_LAYER,
      type: 'line',
    });
  }
}

export function toggleDrilldown(map: maplibregl.Map, uf: null | string): void {
  if (uf) {
    if (map.getLayer(MUN_FILL)) {
      map.setLayoutProperty(MUN_FILL, 'visibility', 'visible');
      map.setFilter(MUN_FILL, ['==', ['get', 'uf'], uf]);
    }
    if (map.getLayer(MUN_OUTLINE)) {
      map.setLayoutProperty(MUN_OUTLINE, 'visibility', 'visible');
      map.setFilter(MUN_OUTLINE, ['==', ['get', 'uf'], uf]);
    }
    if (map.getLayer(UF_FILL)) map.setPaintProperty(UF_FILL, 'fill-opacity', 0.15);
    if (map.getLayer(UF_OUTLINE)) map.setLayoutProperty(UF_OUTLINE, 'visibility', 'none');
  } else {
    if (map.getLayer(MUN_FILL)) map.setLayoutProperty(MUN_FILL, 'visibility', 'none');
    if (map.getLayer(MUN_OUTLINE)) map.setLayoutProperty(MUN_OUTLINE, 'visibility', 'none');
    if (map.getLayer(UF_FILL)) map.setPaintProperty(UF_FILL, 'fill-opacity', 0.75);
    if (map.getLayer(UF_OUTLINE)) map.setLayoutProperty(UF_OUTLINE, 'visibility', 'visible');
  }
}

/**
 * Normalização por raiz quadrada — `sqrt(v) / sqrt(max)`. Linear
 * empurra 24 das 27 UFs pra faixa pálida do ramp porque SP tem ~3×
 * o volume da segunda colocada; log compressa demais e UFs do
 * meio (PA, GO) viram quase pretas. Sqrt é o meio-termo: SP fica
 * no topo (= 1), MG/RJ aterrissam em torno de 0.55, PA em ~0.3,
 * RR em ~0.05 — distribuição visualmente próxima da percepção de
 * área (regra clássica em choropleths com cauda longa).
 *
 * `Math.sqrt(0) === 0`, então UFs sem dado mapeiam pra 0 sem
 * div-by-zero.
 */
function sqrtNormalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.sqrt(Math.max(0, value) / max);
}

/**
 * Rank competition-style (1, 2, 2, 4, …) por volume desc. Empates
 * compartilham posição; a próxima posição pula. Usado pra exibir
 * "Rank N/total" no tooltip — compensa a perda de calibração
 * absoluta da escala sqrt.
 */
function rankByVolume<K, V extends { volume: number }>(byKey: Map<K, V>): Map<K, number> {
  const entries = [...byKey.entries()].sort((a, b) => b[1].volume - a[1].volume);
  const rankByKey = new Map<K, number>();
  let prevVolume = Number.POSITIVE_INFINITY;
  let prevRank = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const [key, item] = entries[i] as [K, V];
    const rank = item.volume === prevVolume ? prevRank : i + 1;
    rankByKey.set(key, rank);
    prevRank = rank;
    prevVolume = item.volume;
  }
  return rankByKey;
}

export function pushUfState(map: maplibregl.Map, byUf: Map<string, BinTotals>): void {
  // `byUf` já vem agregado pela faixa via cubo de prefix-sum (cf.
  // `lib/data-cube.ts`); aqui só normalizamos pelo máximo (em sqrt,
  // pra não deixar SP achatar o resto do país) e empurramos ao
  // MapLibre. Também persistimos rank/total pro tooltip.
  let max = 1;
  for (const v of byUf.values()) if (v.volume > max) max = v.volume;

  const ranks = rankByVolume(byUf);
  const total = byUf.size;
  map.removeFeatureState({ source: SOURCE_ID, sourceLayer: UF_LAYER });
  for (const [sigla, agg] of byUf) {
    map.setFeatureState(
      { id: sigla, source: SOURCE_ID, sourceLayer: UF_LAYER },
      {
        normalizado: sqrtNormalize(agg.volume, max),
        rank: ranks.get(sigla) ?? null,
        rankTotal: total,
        ufName: sigla,
        valor: agg.valor,
        volume: agg.volume,
      },
    );
  }
}

/**
 * Usa `querySourceFeatures` pra descobrir os IDs promoted na tile atual
 * e aplicar feature-state só nos que batem com o agregado (6 dígitos
 * do municipioCode do SIA, comparado contra `codarea.slice(0,6)`).
 */
export function pushMunicipioState(map: maplibregl.Map, byMunicipio: Map<string, BinTotals>): void {
  // PMTiles usa `codarea` de 7 dígitos, agregados de SIA usam 6 ou 7;
  // o cubo veio com a chave do agregado, aqui re-chaveamos por prefixo
  // de 6 dígitos pra casar com `codarea.slice(0,6)` no map.
  const byMun = new Map<string, { municipioNome: string; valor: number; volume: number }>();
  let max = 1;
  for (const v of byMunicipio.values()) {
    const key6 = v.bin.slice(0, 6);
    const prev = byMun.get(key6) ?? { municipioNome: v.label, valor: 0, volume: 0 };
    prev.volume += v.volume;
    prev.valor += v.valor;
    byMun.set(key6, prev);
    if (prev.volume > max) max = prev.volume;
  }

  const ranks = rankByVolume(byMun);
  const total = byMun.size;
  map.removeFeatureState({ source: SOURCE_ID, sourceLayer: MUN_LAYER });
  const features = map.querySourceFeatures(SOURCE_ID, {
    sourceLayer: MUN_LAYER,
    validate: false,
  });
  const idByKey6 = new Map<string, number | string>();
  for (const f of features) {
    const codarea = String(f.properties?.codarea ?? f.id ?? '');
    if (codarea.length >= 6 && f.id !== undefined && f.id !== null) {
      idByKey6.set(codarea.slice(0, 6), f.id);
    }
  }
  for (const [key6, agg] of byMun) {
    const id = idByKey6.get(key6);
    if (id === undefined) continue;
    map.setFeatureState(
      { id, source: SOURCE_ID, sourceLayer: MUN_LAYER },
      {
        municipio: agg.municipioNome,
        normalizado: sqrtNormalize(agg.volume, max),
        rank: ranks.get(key6) ?? null,
        rankTotal: total,
        valor: agg.valor,
        volume: agg.volume,
      },
    );
  }
}
