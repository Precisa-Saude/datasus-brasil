import 'mapbox-gl/dist/mapbox-gl.css';

import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';

import type { MunicipioAggregate, UfAggregate } from '@/lib/aggregates';
import { BRAZIL_BOUNDS, BRAZIL_FIT_PADDING, getMapboxToken } from '@/lib/mapbox';
import { buildOverviewTooltipHtml } from '@/lib/tooltip';

import { MapboxTokenMissing, MapLegend } from './MapLegend';

export interface SelectedMunicipio {
  codigo: string;
  nome: string;
  ufSigla: string;
}

export interface BrasilMapProps {
  /** UFs com dados municipais disponíveis. */
  availableUFs: readonly string[];
  /** Nome legível do biomarcador (ex: "Hemoglobina glicada"). */
  biomarkerDisplay: string;
  /** Catálogo `loinc → display` — usado pelo tooltip do município pra
   *  listar todos os exames agregados na localidade por nome. */
  biomarkersByLoinc: Record<string, string>;
  /** Competência ISO `"YYYY-MM"` — filtra os agregados. */
  competencia: string;
  /** Quando setado, o mapa anima para a UF e mostra o layer municipal. */
  drilldown: null | {
    geoMunicipios: GeoJSON.FeatureCollection;
    municipioData: MunicipioAggregate[];
    ufSigla: string;
  };
  /** GeoJSON nacional com as 27 UFs. */
  geoUF: GeoJSON.FeatureCollection;
  /** Biomarcador LOINC selecionado. */
  loinc: string;
  /** Agregado nacional. */
  ufData: UfAggregate[];
  /** Callback quando um município é clicado (no modo drill-down). */
  onMunicipioClick: (m: SelectedMunicipio) => void;
  /** Callback quando uma UF clicável é clicada. */
  onUfClick: (ufSigla: string) => void;
}

interface LayerRefs {
  click: React.MutableRefObject<((e: mapboxgl.MapLayerMouseEvent) => void) | null>;
  drilldown: React.MutableRefObject<BrasilMapProps['drilldown']>;
  /** Snapshot das props mais recentes pra uso em handlers que
   *  são registrados uma única vez no addSource (evita stale closures). */
  latestProps: React.MutableRefObject<BrasilMapProps | null>;
  mousemove: React.MutableRefObject<((e: mapboxgl.MapLayerMouseEvent) => void) | null>;
  popup: React.MutableRefObject<mapboxgl.Popup | null>;
}

function renderUfLayer(map: mapboxgl.Map, props: BrasilMapProps, refs: LayerRefs): void {
  const filtered = props.ufData.filter(
    (r) => r.loinc === props.loinc && r.competencia === props.competencia,
  );
  const byUf = new Map(filtered.map((r) => [r.ufSigla, r]));
  const max = Math.max(1, ...filtered.map((r) => r.volumeExames));

  const features = props.geoUF.features.map((f) => {
    const sigla = (f.properties?.sigla ?? f.properties?.sigla_uf ?? null) as null | string;
    const agg = sigla ? (byUf.get(sigla) ?? null) : null;
    return {
      ...f,
      properties: {
        ...f.properties,
        normalizado: agg ? agg.volumeExames / max : 0,
        ufName: (f.properties?.name ?? sigla ?? '') as string,
        valor: agg?.valorAprovadoBRL ?? 0,
        volume: agg?.volumeExames ?? 0,
      },
    };
  });
  const collection: GeoJSON.FeatureCollection = { features, type: 'FeatureCollection' };

  const src = map.getSource('uf') as mapboxgl.GeoJSONSource | undefined;
  if (src) {
    src.setData(collection);
  } else {
    map.addSource('uf', { data: collection, type: 'geojson' });
    map.addLayer({
      id: 'uf-fill',
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['get', 'normalizado'],
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
        ],
        'fill-opacity': 0.75,
      },
      source: 'uf',
      type: 'fill',
    });
    map.addLayer({
      id: 'uf-outline',
      paint: { 'line-color': '#463c6d', 'line-width': 0.5 },
      source: 'uf',
      type: 'line',
    });
  }

  attachUfHandlers(map, props, refs);
}

function attachUfHandlers(map: mapboxgl.Map, props: BrasilMapProps, refs: LayerRefs): void {
  const availableSet = new Set(props.availableUFs);
  if (refs.click.current) map.off('click', 'uf-fill', refs.click.current);
  if (refs.mousemove.current) map.off('mousemove', 'uf-fill', refs.mousemove.current);
  const popup =
    refs.popup.current ??
    new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  refs.popup.current = popup;

  const onClick = (e: mapboxgl.MapLayerMouseEvent): void => {
    if (refs.drilldown.current !== null) return;
    const feature = e.features?.[0];
    const sigla = feature?.properties?.sigla ?? feature?.properties?.sigla_uf;
    if (typeof sigla !== 'string' || !availableSet.has(sigla)) return;
    props.onUfClick(sigla);
  };
  const onMousemove = (e: mapboxgl.MapLayerMouseEvent): void => {
    if (refs.drilldown.current !== null) return;
    const feature = e.features?.[0];
    if (!feature) return;
    const latest = refs.latestProps.current;
    if (!latest) return;
    const sigla = (feature.properties?.sigla ?? feature.properties?.sigla_uf ?? '') as string;
    const name = (feature.properties?.ufName ?? sigla) as string;
    map.getCanvas().style.cursor = availableSet.has(sigla) ? 'pointer' : 'default';
    // Total de exames laboratoriais somando todos os LOINCs da UF
    // na competência corrente.
    const total = latest.ufData
      .filter((r) => r.competencia === latest.competencia && r.ufSigla === sigla)
      .reduce((acc, r) => acc + r.volumeExames, 0);
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        buildOverviewTooltipHtml({
          name,
          subtitle: `${sigla}${availableSet.has(sigla) ? ' — clique para detalhar' : ''}`,
          totalLabel: 'exames laboratoriais',
          totalValue: total,
        }),
      )
      .addTo(map);
  };
  map.on('click', 'uf-fill', onClick);
  map.on('mousemove', 'uf-fill', onMousemove);
  map.on('mouseleave', 'uf-fill', () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
  refs.click.current = onClick;
  refs.mousemove.current = onMousemove;
}

function renderMunicipioLayer(map: mapboxgl.Map, props: BrasilMapProps, refs: LayerRefs): void {
  const drill = props.drilldown;
  if (!drill) {
    if (map.getLayer('municipios-fill')) {
      map.setLayoutProperty('municipios-fill', 'visibility', 'none');
    }
    if (map.getLayer('municipios-outline')) {
      map.setLayoutProperty('municipios-outline', 'visibility', 'none');
    }
    if (map.getLayer('uf-fill')) map.setPaintProperty('uf-fill', 'fill-opacity', 0.75);
    map.fitBounds(BRAZIL_BOUNDS, {
      bearing: 180,
      duration: 1200,
      padding: BRAZIL_FIT_PADDING,
    });
    return;
  }

  const filtered = drill.municipioData.filter(
    (r) => r.loinc === props.loinc && r.competencia === props.competencia,
  );
  // IBGE `codarea` tem 7 dígitos (com DV), SIA `PA_UFMUN` tem 6 (sem DV).
  const byMun = new Map(filtered.map((r) => [r.municipioCode.slice(0, 6), r]));
  const maxM = Math.max(1, ...filtered.map((r) => r.volumeExames));

  const features = drill.geoMunicipios.features.map((f) => {
    const code = (f.properties?.codarea ?? null) as null | string;
    const geoNome = (f.properties?.nome ?? null) as null | string;
    const key6 = typeof code === 'string' ? code.slice(0, 6) : null;
    const agg = key6 ? (byMun.get(key6) ?? null) : null;
    return {
      ...f,
      properties: {
        ...f.properties,
        municipio: agg?.municipioNome ?? geoNome ?? code ?? '',
        normalizado: agg ? agg.volumeExames / maxM : 0,
        valor: agg?.valorAprovadoBRL ?? 0,
        volume: agg?.volumeExames ?? 0,
      },
    };
  });
  const collection: GeoJSON.FeatureCollection = { features, type: 'FeatureCollection' };

  const src = map.getSource('municipios') as mapboxgl.GeoJSONSource | undefined;
  if (src) {
    src.setData(collection);
  } else {
    map.addSource('municipios', { data: collection, type: 'geojson' });
    map.addLayer({
      id: 'municipios-fill',
      paint: {
        // Mesma paleta violeta das UFs — consistência visual entre as
        // duas visões (nacional × municipal).
        'fill-color': [
          'interpolate',
          ['linear'],
          ['get', 'normalizado'],
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
        ],
        // Município sem volume = 100% transparente; caso contrário 0.75.
        // Evita falso-positivo visual (cor idêntica a cidades de baixo
        // volume real) e mantém o clique/tooltip ativos via outline.
        'fill-opacity': ['case', ['>', ['get', 'volume'], 0], 0.75, 0],
      },
      source: 'municipios',
      type: 'fill',
    });
    map.addLayer({
      id: 'municipios-outline',
      paint: { 'line-color': '#463c6d', 'line-width': 0.4 },
      source: 'municipios',
      type: 'line',
    });
    attachMunicipioHandlers(map, props, refs);
  }

  if (map.getLayer('municipios-fill')) {
    map.setLayoutProperty('municipios-fill', 'visibility', 'visible');
  }
  if (map.getLayer('municipios-outline')) {
    map.setLayoutProperty('municipios-outline', 'visibility', 'visible');
  }
  if (map.getLayer('uf-fill')) map.setPaintProperty('uf-fill', 'fill-opacity', 0.15);
  if (map.getLayer('uf-outline')) map.setLayoutProperty('uf-outline', 'visibility', 'visible');

  const ufBounds = new mapboxgl.LngLatBounds();
  for (const feature of drill.geoMunicipios.features) {
    extractCoords(feature.geometry).forEach(([lng, lat]) => ufBounds.extend([lng, lat]));
  }
  if (!ufBounds.isEmpty()) {
    map.fitBounds(ufBounds, { bearing: 180, duration: 1200, padding: 40 });
  }
}

function attachMunicipioHandlers(map: mapboxgl.Map, _props: BrasilMapProps, refs: LayerRefs): void {
  const popup =
    refs.popup.current ??
    new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  refs.popup.current = popup;

  const resolveContext = (
    feature: mapboxgl.MapboxGeoJSONFeature,
  ): null | {
    codarea: string;
    hasData: boolean;
    key6: string;
    municipio: string;
    total: number;
    uf: string;
  } => {
    const latest = refs.latestProps.current;
    if (!latest || !latest.drilldown) return null;
    const rawMunicipio = String(feature.properties?.municipio ?? '');
    const codarea = String(feature.properties?.codarea ?? '');
    const key6 = codarea.slice(0, 6);
    const total = latest.drilldown.municipioData
      .filter((r) => r.competencia === latest.competencia && r.municipioCode.slice(0, 6) === key6)
      .reduce((acc, r) => acc + r.volumeExames, 0);
    const hasData = total > 0;
    // `rawMunicipio` vem do feature — que é alimentado pelo aggregate
    // quando tem dados, ou pelo `nome` injetado no GeoJSON pelo script
    // aggregate-sia (a partir de `findMunicipio`). Fallback final: o
    // código IBGE cru.
    const municipio = rawMunicipio || codarea;
    return { codarea, hasData, key6, municipio, total, uf: latest.drilldown.ufSigla };
  };

  map.on('mousemove', 'municipios-fill', (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const ctx = resolveContext(feature);
    if (!ctx) return;
    map.getCanvas().style.cursor = ctx.hasData ? 'pointer' : 'default';
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        buildOverviewTooltipHtml({
          name: `${ctx.municipio} — ${ctx.uf}`,
          subtitle: ctx.hasData
            ? 'Clique para ver todos os exames'
            : 'Sem exames faturados nesta competência',
          totalLabel: 'exames laboratoriais',
          totalValue: ctx.total,
        }),
      )
      .addTo(map);
  });
  map.on('mouseleave', 'municipios-fill', () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
  map.on('click', 'municipios-fill', (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const ctx = resolveContext(feature);
    if (!ctx || !ctx.hasData) return;
    refs.latestProps.current?.onMunicipioClick({
      codigo: ctx.codarea,
      nome: ctx.municipio,
      ufSigla: ctx.uf,
    });
  });
}

/**
 * Mapa único Brasil + drill-down. Mantém a mesma instância do Mapbox
 * em todas as transições: switch UF↔município é feito por
 * add/remove de layers e `fitBounds` animado, sem destruir o Map —
 * evita o flicker da re-montagem do WebGL context.
 */
export function BrasilMap(props: BrasilMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const loadedRef = useRef(false);
  const clickHandlerRef = useRef<((e: mapboxgl.MapLayerMouseEvent) => void) | null>(null);
  const mousemoveHandlerRef = useRef<((e: mapboxgl.MapLayerMouseEvent) => void) | null>(null);
  // Ref com o estado de drill-down corrente — consultada pelos handlers
  // do layer UF para não disparar tooltip/click quando o usuário está
  // efetivamente interagindo com o layer municipal por cima.
  const drilldownRef = useRef(props.drilldown);
  drilldownRef.current = props.drilldown;
  const latestPropsRef = useRef<BrasilMapProps | null>(null);
  latestPropsRef.current = props;
  const token = getMapboxToken();

  // Criação única da instância.
  useEffect(() => {
    if (!token || !containerRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      // `bearing: 180` roda o mapa para "sul em cima / norte embaixo".
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
    });
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, [token]);

  // Renderiza/atualiza o layer UF (nacional).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const refs: LayerRefs = {
      click: clickHandlerRef,
      drilldown: drilldownRef,
      latestProps: latestPropsRef,
      mousemove: mousemoveHandlerRef,
      popup: popupRef,
    };
    const apply = (): void => renderUfLayer(map, props, refs);
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [
    props.ufData,
    props.geoUF,
    props.loinc,
    props.competencia,
    props.availableUFs,
    props.biomarkerDisplay,
    props.onUfClick,
    props,
  ]);

  // Renderiza/atualiza/remove o layer municipal, e anima entre UF e Brasil.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const refs: LayerRefs = {
      click: clickHandlerRef,
      drilldown: drilldownRef,
      latestProps: latestPropsRef,
      mousemove: mousemoveHandlerRef,
      popup: popupRef,
    };
    const apply = (): void => renderMunicipioLayer(map, props, refs);
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [props.drilldown, props.loinc, props.competencia, props.biomarkerDisplay, props]);

  if (!token) return <MapboxTokenMissing />;

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full" ref={containerRef} />
      <MapLegend drilldown={props.drilldown !== null} />
    </div>
  );
}

function extractCoords(geom: GeoJSON.Geometry): Array<[number, number]> {
  if (geom.type === 'Polygon') return geom.coordinates.flat() as Array<[number, number]>;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2) as Array<[number, number]>;
  return [];
}
