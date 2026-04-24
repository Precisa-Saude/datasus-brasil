/**
 * Funções puras de configuração/atualização de layers do MapLibre
 * para o choropleth Brasil + drill-down UF. Extraído do
 * `BrasilMap.tsx` só pra manter o componente dentro do limite de
 * linhas — contém zero estado React.
 */

import type maplibregl from 'maplibre-gl';

import type { MunicipioAggregate, UfAggregate } from './aggregates';
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
    map.addLayer({
      id: MUN_FILL,
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

export function pushUfState(
  map: maplibregl.Map,
  ufData: readonly UfAggregate[],
  competencia: string,
): void {
  // Soma todos os biomarcadores (sem filtro de LOINC) — cor reflete
  // volume laboratorial total do mês por UF.
  const filtered = ufData.filter((r) => r.competencia === competencia);
  const somaPorUf = new Map<string, { valor: number; volume: number }>();
  for (const r of filtered) {
    const prev = somaPorUf.get(r.ufSigla) ?? { valor: 0, volume: 0 };
    prev.volume += r.volumeExames;
    prev.valor += r.valorAprovadoBRL;
    somaPorUf.set(r.ufSigla, prev);
  }
  const max = Math.max(1, ...[...somaPorUf.values()].map((v) => v.volume));

  map.removeFeatureState({ source: SOURCE_ID, sourceLayer: UF_LAYER });
  for (const [sigla, agg] of somaPorUf) {
    map.setFeatureState(
      { id: sigla, source: SOURCE_ID, sourceLayer: UF_LAYER },
      {
        normalizado: agg.volume / max,
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
export function pushMunicipioState(
  map: maplibregl.Map,
  data: readonly MunicipioAggregate[],
  competencia: string,
): void {
  // Soma todos os biomarcadores (sem filtro de LOINC) — cor reflete
  // volume laboratorial total do mês por município.
  const filtered = data.filter((r) => r.competencia === competencia);
  const byMun = new Map<string, { municipioNome: string; valor: number; volume: number }>();
  for (const r of filtered) {
    const key6 = r.municipioCode.slice(0, 6);
    const prev = byMun.get(key6) ?? { municipioNome: r.municipioNome, valor: 0, volume: 0 };
    prev.volume += r.volumeExames;
    prev.valor += r.valorAprovadoBRL;
    byMun.set(key6, prev);
  }
  const max = Math.max(1, ...[...byMun.values()].map((v) => v.volume));

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
        normalizado: agg.volume / max,
        valor: agg.valor,
        volume: agg.volume,
      },
    );
  }
}
