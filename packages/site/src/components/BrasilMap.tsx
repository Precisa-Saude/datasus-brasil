import 'mapbox-gl/dist/mapbox-gl.css';

import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';

import type { MunicipioAggregate, UfAggregate } from '@/lib/aggregates';
import { PMTILES_URL } from '@/lib/data-source';
import { BRAZIL_BOUNDS, BRAZIL_FIT_PADDING, getMapboxToken } from '@/lib/mapbox';
import { ensurePmtilesProtocol } from '@/lib/pmtiles-protocol';
import { buildOverviewTooltipHtml } from '@/lib/tooltip';

import { MapboxTokenMissing, MapLegend } from './MapLegend';

export interface SelectedMunicipio {
  codigo: string;
  nome: string;
  ufSigla: string;
}

export interface BrasilMapProps {
  availableUFs: readonly string[];
  biomarkerDisplay: string;
  biomarkersByLoinc: Record<string, string>;
  competencia: string;
  loinc: string;
  /** Agregado municipal da UF ativa no drill-down (ou null). */
  municipioData: MunicipioAggregate[] | null;
  selectedUf: null | string;
  /** Agregado nacional. */
  ufData: UfAggregate[];
  onMunicipioClick: (m: SelectedMunicipio) => void;
  onUfClick: (ufSigla: string) => void;
}

interface LayerRefs {
  latestProps: React.MutableRefObject<BrasilMapProps | null>;
  popup: React.MutableRefObject<mapboxgl.Popup | null>;
}

const SOURCE_ID = 'brasil';
// Layers vindos do tippecanoe (ver scripts/build-geo-tiles.sh).
const UF_LAYER = 'ufs';
const MUN_LAYER = 'municipios';

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

function pushUfState(
  map: mapboxgl.Map,
  ufData: readonly UfAggregate[],
  loinc: string,
  competencia: string,
): void {
  const filtered = ufData.filter((r) => r.loinc === loinc && r.competencia === competencia);
  const byUf = new Map(filtered.map((r) => [r.ufSigla, r]));
  const max = Math.max(1, ...filtered.map((r) => r.volumeExames));

  // Zera todas as UFs primeiro; depois escreve as que têm dados.
  // `removeFeatureState` limpa tudo pra aquela source-layer.
  map.removeFeatureState({ source: SOURCE_ID, sourceLayer: UF_LAYER });
  for (const [sigla, agg] of byUf) {
    map.setFeatureState(
      { id: sigla, source: SOURCE_ID, sourceLayer: UF_LAYER },
      {
        normalizado: agg.volumeExames / max,
        ufName: sigla,
        valor: agg.valorAprovadoBRL,
        volume: agg.volumeExames,
      },
    );
  }
}

function pushMunicipioState(
  map: mapboxgl.Map,
  data: readonly MunicipioAggregate[],
  loinc: string,
  competencia: string,
): void {
  const filtered = data.filter((r) => r.loinc === loinc && r.competencia === competencia);
  // IBGE `codarea` = 7 dígitos, mas o tippecanoe usou `codarea` como
  // promoteId — a feature-id é o valor literal do GeoJSON.
  const byMun = new Map(filtered.map((r) => [r.municipioCode.slice(0, 6), r]));
  const max = Math.max(1, ...filtered.map((r) => r.volumeExames));

  map.removeFeatureState({ source: SOURCE_ID, sourceLayer: MUN_LAYER });
  // Varre as features vector atualmente carregadas — só dá pra setar
  // state num ID que existe na tile. Uso `queryRenderedFeatures` na
  // layer municipal pra pegar IDs visíveis; `setFeatureState` funciona
  // mesmo em features ainda-não-renderizadas se o promoteId estiver
  // configurado corretamente (Mapbox guarda em cache).
  for (const [key6, agg] of byMun) {
    // Tenta 7 dígitos (mais 0 comum no DV, nem sempre 0).
    // Estratégia: pro match robusto, usamos a FeatureCollection gerada
    // por tippecanoe, onde `codarea` retém 7 dígitos. Como não sabemos
    // o DV exato, usamos o expression `starts-with` num filter — mas
    // setFeatureState exige ID exato. Solução: buscar features via
    // querySourceFeatures e matchar key6 com slice.
    const matches = map.querySourceFeatures(SOURCE_ID, {
      sourceLayer: MUN_LAYER,
      validate: false,
    });
    for (const f of matches) {
      const codarea = String(f.properties?.codarea ?? '');
      if (codarea.slice(0, 6) !== key6) continue;
      map.setFeatureState(
        { id: codarea, source: SOURCE_ID, sourceLayer: MUN_LAYER },
        {
          municipio: agg.municipioNome,
          normalizado: agg.volumeExames / max,
          valor: agg.valorAprovadoBRL,
          volume: agg.volumeExames,
        },
      );
    }
  }
}

function attachHandlers(map: mapboxgl.Map, refs: LayerRefs): void {
  const popup =
    refs.popup.current ??
    new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  refs.popup.current = popup;

  map.on('mousemove', UF_LAYER, (e) => {
    const latest = refs.latestProps.current;
    if (!latest || latest.selectedUf !== null) return;
    const feature = e.features?.[0];
    if (!feature) return;
    const sigla = String(feature.properties?.sigla ?? feature.id ?? '');
    const state = map.getFeatureState({
      id: sigla,
      source: SOURCE_ID,
      sourceLayer: UF_LAYER,
    }) as { volume?: number } | null;
    const hasData = latest.availableUFs.includes(sigla);
    map.getCanvas().style.cursor = hasData ? 'pointer' : 'default';
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        buildOverviewTooltipHtml({
          name: String(feature.properties?.name ?? sigla),
          subtitle: `${sigla}${hasData ? ' — clique para detalhar' : ' — sem dados'}`,
          totalLabel: 'exames laboratoriais',
          totalValue: Number(state?.volume ?? 0),
        }),
      )
      .addTo(map);
  });
  map.on('mouseleave', UF_LAYER, () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
  map.on('click', UF_LAYER, (e) => {
    const latest = refs.latestProps.current;
    if (!latest || latest.selectedUf !== null) return;
    const feature = e.features?.[0];
    const sigla = String(feature?.properties?.sigla ?? feature?.id ?? '');
    if (!latest.availableUFs.includes(sigla)) return;
    latest.onUfClick(sigla);
  });

  map.on('mousemove', MUN_LAYER, (e) => {
    const latest = refs.latestProps.current;
    if (!latest || latest.selectedUf === null) return;
    const feature = e.features?.[0];
    if (!feature) return;
    const featureUf = String(feature.properties?.uf ?? '');
    if (featureUf !== latest.selectedUf) return;
    const codarea = String(feature.properties?.codarea ?? feature.id ?? '');
    const state = map.getFeatureState({
      id: codarea,
      source: SOURCE_ID,
      sourceLayer: MUN_LAYER,
    }) as { municipio?: string; volume?: number } | null;
    const name = state?.municipio ?? String(feature.properties?.nome ?? `código ${codarea}`);
    const hasData = Number(state?.volume ?? 0) > 0;
    map.getCanvas().style.cursor = hasData ? 'pointer' : 'default';
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        buildOverviewTooltipHtml({
          name: `${name} — ${featureUf}`,
          subtitle: hasData
            ? 'Clique para ver todos os exames'
            : 'Sem exames faturados nesta competência',
          totalLabel: 'exames laboratoriais',
          totalValue: Number(state?.volume ?? 0),
        }),
      )
      .addTo(map);
  });
  map.on('mouseleave', MUN_LAYER, () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
  map.on('click', MUN_LAYER, (e) => {
    const latest = refs.latestProps.current;
    if (!latest || latest.selectedUf === null) return;
    const feature = e.features?.[0];
    if (!feature) return;
    const featureUf = String(feature.properties?.uf ?? '');
    if (featureUf !== latest.selectedUf) return;
    const codarea = String(feature.properties?.codarea ?? feature.id ?? '');
    const state = map.getFeatureState({
      id: codarea,
      source: SOURCE_ID,
      sourceLayer: MUN_LAYER,
    }) as { municipio?: string; volume?: number } | null;
    if (Number(state?.volume ?? 0) === 0) return;
    latest.onMunicipioClick({
      codigo: codarea,
      nome: state?.municipio ?? String(feature.properties?.nome ?? codarea),
      ufSigla: featureUf,
    });
  });
}

function addLayers(map: mapboxgl.Map): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      promoteId: { municipios: 'codarea', ufs: 'sigla' },
      type: 'vector',
      url: `pmtiles://${PMTILES_URL}`,
    });
  }
  if (!map.getLayer('uf-fill')) {
    map.addLayer({
      id: 'uf-fill',
      paint: {
        'fill-color': VIOLET_RAMP as unknown as mapboxgl.ExpressionSpecification,
        'fill-opacity': 0.75,
      },
      source: SOURCE_ID,
      'source-layer': UF_LAYER,
      type: 'fill',
    });
    map.addLayer({
      id: 'uf-outline',
      paint: { 'line-color': '#463c6d', 'line-width': 0.5 },
      source: SOURCE_ID,
      'source-layer': UF_LAYER,
      type: 'line',
    });
  }
  if (!map.getLayer('municipios-fill')) {
    map.addLayer({
      id: 'municipios-fill',
      paint: {
        'fill-color': VIOLET_RAMP as unknown as mapboxgl.ExpressionSpecification,
        'fill-opacity': [
          'case',
          ['>', ['coalesce', ['feature-state', 'volume'], 0], 0],
          0.75,
          0,
        ] as unknown as mapboxgl.ExpressionSpecification,
      },
      source: SOURCE_ID,
      'source-layer': MUN_LAYER,
      type: 'fill',
    });
    map.addLayer({
      id: 'municipios-outline',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#463c6d', 'line-width': 0.4 },
      source: SOURCE_ID,
      'source-layer': MUN_LAYER,
      type: 'line',
    });
  }
}

function toggleDrilldown(map: mapboxgl.Map, uf: null | string): void {
  if (uf) {
    if (map.getLayer('municipios-fill')) {
      map.setLayoutProperty('municipios-fill', 'visibility', 'visible');
      map.setFilter('municipios-fill', ['==', ['get', 'uf'], uf]);
    }
    if (map.getLayer('municipios-outline')) {
      map.setLayoutProperty('municipios-outline', 'visibility', 'visible');
      map.setFilter('municipios-outline', ['==', ['get', 'uf'], uf]);
    }
    if (map.getLayer('uf-fill')) map.setPaintProperty('uf-fill', 'fill-opacity', 0.15);
  } else {
    if (map.getLayer('municipios-fill')) {
      map.setLayoutProperty('municipios-fill', 'visibility', 'none');
    }
    if (map.getLayer('municipios-outline')) {
      map.setLayoutProperty('municipios-outline', 'visibility', 'none');
    }
    if (map.getLayer('uf-fill')) map.setPaintProperty('uf-fill', 'fill-opacity', 0.75);
  }
}

export function BrasilMap(props: BrasilMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const loadedRef = useRef(false);
  const latestPropsRef = useRef<BrasilMapProps | null>(null);
  latestPropsRef.current = props;
  const token = getMapboxToken();

  // Inicializa Mapbox + PMTiles uma vez.
  useEffect(() => {
    if (!token || !containerRef.current) return;
    ensurePmtilesProtocol();
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      bearing: 180,
      bounds: BRAZIL_BOUNDS,
      container: containerRef.current,
      fitBoundsOptions: { bearing: 180, padding: BRAZIL_FIT_PADDING },
      projection: 'mercator',
      style: 'mapbox://styles/mapbox/light-v11',
    });
    mapRef.current = map;
    map.once('load', () => {
      loadedRef.current = true;
      addLayers(map);
      attachHandlers(map, { latestProps: latestPropsRef, popup: popupRef });
    });
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, [token]);

  // Atualiza feature-state da UF quando filtros mudam.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => pushUfState(map, props.ufData, props.loinc, props.competencia);
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [props.ufData, props.loinc, props.competencia]);

  // Atualiza feature-state do drill-down quando entra numa UF ou muda filtro.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      toggleDrilldown(map, props.selectedUf);
      if (props.selectedUf) {
        // Anima para o UF selecionado; bounds aproximados via fitBounds
        // do centróide dos municípios carregados quando o tile chegar.
        const features = map.querySourceFeatures(SOURCE_ID, {
          filter: ['==', ['get', 'sigla'], props.selectedUf],
          sourceLayer: UF_LAYER,
        });
        if (features.length > 0) {
          const bounds = new mapboxgl.LngLatBounds();
          extractCoords(features[0]!.geometry).forEach((c) => bounds.extend(c));
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { bearing: 180, duration: 1200, padding: 40 });
          }
        }
        if (props.municipioData) {
          pushMunicipioState(map, props.municipioData, props.loinc, props.competencia);
        }
      } else {
        map.fitBounds(BRAZIL_BOUNDS, {
          bearing: 180,
          duration: 1200,
          padding: BRAZIL_FIT_PADDING,
        });
      }
    };
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [props.selectedUf, props.municipioData, props.loinc, props.competencia]);

  if (!token) return <MapboxTokenMissing />;

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full" ref={containerRef} />
      <MapLegend drilldown={props.selectedUf !== null} />
    </div>
  );
}

function extractCoords(geom: GeoJSON.Geometry): Array<[number, number]> {
  if (geom.type === 'Polygon') return geom.coordinates.flat() as Array<[number, number]>;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2) as Array<[number, number]>;
  return [];
}
