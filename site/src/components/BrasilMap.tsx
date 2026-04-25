import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import type { MunicipioAggregate, UfAggregate } from '@/lib/aggregates';
import {
  addMapLayers,
  MUN_FILL,
  MUN_LAYER,
  pushMunicipioState,
  pushUfState,
  SOURCE_ID,
  toggleDrilldown,
  UF_FILL,
  UF_LAYER,
} from '@/lib/map-layers';
import { BASEMAP_STYLE, BRAZIL_BOUNDS, BRAZIL_FIT_PADDING, BRAZIL_MAX_BOUNDS } from '@/lib/mapbox';
import { ensurePmtilesProtocol } from '@/lib/pmtiles-protocol';
import { buildOverviewTooltipHtml } from '@/lib/tooltip';

import { MapLegend } from './MapLegend';

export interface SelectedMunicipio {
  codigo: string;
  nome: string;
  ufSigla: string;
}

export interface BrasilMapProps {
  availableUFs: readonly string[];
  competencia: string;
  /** Quando setado, pede que o mapa centralize/zoom no município (codarea). */
  focusMunCodigo: null | string;
  /** Agregado municipal da UF ativa no drill-down (ou null). */
  municipioData: MunicipioAggregate[] | null;
  /** Contador que, ao mudar, pede fit aos bounds da UF atual. */
  refitUfSignal: number;
  selectedUf: null | string;
  /** Agregado nacional. */
  ufData: UfAggregate[];
  onMunicipioClick: (m: SelectedMunicipio) => void;
  onUfClick: (ufSigla: string) => void;
  /** Disparado quando o usuário dá zoom out o suficiente no drill-down. */
  onZoomOutReset: () => void;
}

interface LayerRefs {
  latestProps: React.MutableRefObject<BrasilMapProps | null>;
  popup: React.MutableRefObject<maplibregl.Popup | null>;
}

function attachHandlers(map: maplibregl.Map, refs: LayerRefs): void {
  const popup =
    refs.popup.current ??
    new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  refs.popup.current = popup;

  map.on('mousemove', UF_FILL, (e) => {
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
  map.on('mouseleave', UF_FILL, () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
  // Click no mapa todo (não só UF_FILL) — `MUN_FILL` está acima do
  // UF_FILL com fill-opacity 0 quando sem dado, e ainda capturava clicks
  // intercedendo o handler de UF antes do drill-down. Aqui usamos
  // queryRenderedFeatures restrito a UF_LAYER pra ignorar overlays.
  map.on('click', (e) => {
    const latest = refs.latestProps.current;
    if (!latest || latest.selectedUf !== null) return;
    const feats = map.queryRenderedFeatures(e.point, { layers: [UF_FILL] });
    const feature = feats[0];
    if (!feature) return;
    const sigla = String(feature.properties?.sigla ?? feature.id ?? '');
    if (!latest.availableUFs.includes(sigla)) return;
    latest.onUfClick(sigla);
  });

  map.on('mousemove', MUN_FILL, (e) => {
    const latest = refs.latestProps.current;
    if (!latest || latest.selectedUf === null) return;
    const feature = e.features?.[0];
    if (!feature) return;
    const featureUf = String(feature.properties?.uf ?? '');
    if (featureUf !== latest.selectedUf) return;
    const codareaStr = String(feature.properties?.codarea ?? feature.id ?? '');
    const featId = feature.id ?? codareaStr;
    const state = map.getFeatureState({
      id: featId,
      source: SOURCE_ID,
      sourceLayer: MUN_LAYER,
    }) as { municipio?: string; volume?: number } | null;
    const name = state?.municipio ?? String(feature.properties?.nome ?? `código ${codareaStr}`);
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
  map.on('mouseleave', MUN_FILL, () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
  map.on('click', MUN_FILL, (e) => {
    const latest = refs.latestProps.current;
    if (!latest || latest.selectedUf === null) return;
    const feature = e.features?.[0];
    if (!feature) return;
    const featureUf = String(feature.properties?.uf ?? '');
    if (featureUf !== latest.selectedUf) return;
    const codareaStr = String(feature.properties?.codarea ?? feature.id ?? '');
    const featId = feature.id ?? codareaStr;
    const state = map.getFeatureState({
      id: featId,
      source: SOURCE_ID,
      sourceLayer: MUN_LAYER,
    }) as { municipio?: string; volume?: number } | null;
    if (Number(state?.volume ?? 0) === 0) return;
    map.easeTo({ center: e.lngLat, duration: 600, zoom: Math.max(map.getZoom(), 10) });
    latest.onMunicipioClick({
      codigo: codareaStr,
      nome: state?.municipio ?? String(feature.properties?.nome ?? codareaStr),
      ufSigla: featureUf,
    });
  });

  // Reset automático: zoom out no drill-down volta pra visão Brasil.
  // Só reage a zoom-out do usuário (wheel/pinch/dblclick) — programático
  // (fitBounds do próprio drilldown) não tem originalEvent e fica de fora,
  // senão o fit pra UF dispara o reset e cancela o drill antes de mostrar.
  map.on('zoomend', (e) => {
    if (!e.originalEvent) return;
    const latest = refs.latestProps.current;
    if (!latest || latest.selectedUf === null) return;
    if (map.getZoom() < 4.2) latest.onZoomOutReset();
  });
}

export function BrasilMap(props: BrasilMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const loadedRef = useRef(false);
  const ufBoundsRef = useRef<Map<string, maplibregl.LngLatBounds>>(new Map());
  const latestPropsRef = useRef<BrasilMapProps | null>(null);
  latestPropsRef.current = props;

  // Inicializa MapLibre + PMTiles uma vez.
  useEffect(() => {
    if (!containerRef.current) return;
    ensurePmtilesProtocol();
    const map = new maplibregl.Map({
      // compact: true mantém a atribuição colapsada no ícone (i) por
      // padrão, sem ocupar espaço sobre o mapa.
      attributionControl: { compact: true },
      bearing: 180,
      bounds: BRAZIL_BOUNDS,
      container: containerRef.current,
      fitBoundsOptions: { bearing: 180, padding: BRAZIL_FIT_PADDING },
      // Impede pan além do Brasil + evita artefatos de world-wrap
      // horizontal (polígonos duplicados quando o mapa scrolla sobre
      // o antimeridian em zoom baixo).
      maxBounds: BRAZIL_MAX_BOUNDS,
      maxZoom: 10,
      minZoom: 3,
      renderWorldCopies: false,
      style: BASEMAP_STYLE,
    });
    mapRef.current = map;
    map.once('load', () => {
      loadedRef.current = true;
      addMapLayers(map);
      attachHandlers(map, { latestProps: latestPropsRef, popup: popupRef });
    });
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Atualiza feature-state da UF quando filtros mudam.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => pushUfState(map, props.ufData, props.competencia);
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [props.ufData, props.competencia]);

  // Transição de UF (entrar/sair do drill-down): toggle layers + fitBounds.
  // Isolado de mudanças de competência/municipioData para preservar o zoom
  // e posição atuais quando o usuário arrasta o slider.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): void => {
      try {
        toggleDrilldown(map, props.selectedUf);
        if (props.selectedUf) fitToUf(map, props.selectedUf, ufBoundsRef.current);
        else fitToBrazil(map);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[BrasilMap drill-down apply]', err);
      }
    };
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [props.selectedUf]);

  // Refit pedido explicitamente (ex.: fechar painel de município).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.selectedUf) return;
    if (loadedRef.current) fitToUf(map, props.selectedUf, ufBoundsRef.current);
  }, [props.refitUfSignal, props.selectedUf]);

  // Foco em município via código (ex.: clique na linha da tabela).
  useEffect(() => {
    const map = mapRef.current;
    const codigo = props.focusMunCodigo;
    if (!map || !codigo || !props.selectedUf) return;
    const run = (): void => focusMunicipio(map, codigo);
    if (loadedRef.current) run();
    else map.once('load', run);
  }, [props.focusMunCodigo, props.selectedUf]);

  // Reaplica feature-state municipal quando o dado muda (competência ou
  // município) sem mexer em zoom/centro.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.selectedUf || !props.municipioData) return;
    const muni = props.municipioData;
    const comp = props.competencia;
    const tryApply = (): boolean => {
      const f = map.querySourceFeatures(SOURCE_ID, { sourceLayer: MUN_LAYER });
      if (f.length === 0) return false;
      pushMunicipioState(map, muni, comp);
      return true;
    };
    const run = (): void => {
      if (!tryApply()) {
        const retry = (): void => {
          if (tryApply()) map.off('sourcedata', retry);
        };
        map.on('sourcedata', retry);
      }
    };
    if (loadedRef.current) run();
    else map.once('load', run);
  }, [props.selectedUf, props.municipioData, props.competencia]);

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full" ref={containerRef} />
      <MapLegend drilldown={props.selectedUf !== null} />
    </div>
  );
}

function fitToUf(
  map: maplibregl.Map,
  uf: string,
  cache: Map<string, maplibregl.LngLatBounds>,
): void {
  // Se já temos bounds em cache (computados quando a UF inteira estava
  // visível no tile zoom 3), usa — senão querySourceFeatures só retorna
  // a fatia da UF nos tiles carregados e o fit vira em cima dessa fatia.
  let bounds = cache.get(uf);
  if (!bounds || bounds.isEmpty()) {
    const features = map.querySourceFeatures(SOURCE_ID, {
      filter: ['==', ['get', 'sigla'], uf],
      sourceLayer: UF_LAYER,
    });
    const b = new maplibregl.LngLatBounds();
    for (const f of features) {
      try {
        extractCoords(f.geometry).forEach((c) => b.extend(c));
      } catch {
        // Geometria inesperada — pula.
      }
    }
    if (!b.isEmpty()) {
      cache.set(uf, b);
      bounds = b;
    }
  }
  if (bounds && !bounds.isEmpty()) {
    map.fitBounds(bounds, { bearing: 180, duration: 1200, padding: 40 });
  }
}

function focusMunicipio(map: maplibregl.Map, codigo: string): void {
  const key6 = codigo.slice(0, 6);
  const features = map.querySourceFeatures(SOURCE_ID, { sourceLayer: MUN_LAYER });
  const match = features.find((f) => String(f.properties?.codarea ?? '').slice(0, 6) === key6);
  if (!match) return;
  const bounds = new maplibregl.LngLatBounds();
  extractCoords(match.geometry).forEach((c) => bounds.extend(c));
  if (bounds.isEmpty()) return;
  map.easeTo({
    center: bounds.getCenter(),
    duration: 600,
    zoom: Math.max(map.getZoom(), 10),
  });
}

function fitToBrazil(map: maplibregl.Map): void {
  map.fitBounds(BRAZIL_BOUNDS, {
    bearing: 180,
    duration: 1200,
    padding: BRAZIL_FIT_PADDING,
  });
}

function extractCoords(geom: GeoJSON.Geometry | null | undefined): Array<[number, number]> {
  if (!geom) return [];
  if (geom.type === 'Polygon') {
    const pts: Array<[number, number]> = [];
    for (const ring of geom.coordinates) {
      for (const p of ring) {
        if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') {
          pts.push([p[0], p[1]]);
        }
      }
    }
    return pts;
  }
  if (geom.type === 'MultiPolygon') {
    const pts: Array<[number, number]> = [];
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        for (const p of ring) {
          if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') {
            pts.push([p[0], p[1]]);
          }
        }
      }
    }
    return pts;
  }
  return [];
}
