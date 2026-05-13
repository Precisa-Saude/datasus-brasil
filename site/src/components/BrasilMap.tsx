import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import type { BinTotals } from '@/lib/data-cube';
import {
  addMapLayers,
  applyMunicipioStatePatch,
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
  /** Quando setado, pede que o mapa centralize/zoom no município (codarea). */
  focusMunCodigo: null | string;
  /** Totais municipais da UF ativa, agregados sobre a faixa via cubo. */
  municipioTotals: Map<string, BinTotals> | null;
  /** Contador que, ao mudar, pede fit aos bounds da UF atual. */
  refitUfSignal: number;
  selectedUf: null | string;
  /** Totais nacionais por UF, agregados sobre a faixa via cubo. */
  ufTotals: Map<string, BinTotals>;
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
    }) as { rank?: number; rankTotal?: number; volume?: number } | null;
    const hasData = latest.availableUFs.includes(sigla);
    map.getCanvas().style.cursor = hasData ? 'pointer' : 'default';
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        buildOverviewTooltipHtml({
          name: String(feature.properties?.name ?? sigla),
          rank: state?.rank,
          rankTotal: state?.rankTotal,
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
    }) as {
      municipio?: string;
      rank?: number;
      rankTotal?: number;
      volume?: number;
    } | null;
    const name = state?.municipio ?? String(feature.properties?.nome ?? `código ${codareaStr}`);
    const hasData = Number(state?.volume ?? 0) > 0;
    map.getCanvas().style.cursor = hasData ? 'pointer' : 'default';
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        buildOverviewTooltipHtml({
          name: `${name} — ${featureUf}`,
          rank: state?.rank,
          rankTotal: state?.rankTotal,
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
    const apply = (): void => pushUfState(map, props.ufTotals);
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [props.ufTotals]);

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

  // Foco em município via código (ex.: clique na linha da tabela ou
  // deep link `/uf/SP/mun/350390`). Em deep link, o `fitToUf` ainda
  // está animando quando este effect roda, então a feature do
  // município alvo pode não estar em viewport / em tile carregado e
  // `querySourceFeatures` devolve []. Retry no `sourcedata` até a
  // feature aparecer, mesma estratégia da reaplicação de feature-state
  // logo abaixo. Cleanup do listener removido quando o effect
  // re-roda (mudança de UF ou de código) ou quando o componente
  // desmonta — evita listener pendente disparando focus em município
  // errado depois.
  useEffect(() => {
    const map = mapRef.current;
    const codigo = props.focusMunCodigo;
    if (!map || !codigo || !props.selectedUf) return;
    let listener: ((e: maplibregl.MapSourceDataEvent) => void) | null = null;
    const tryFocus = (): boolean => focusMunicipio(map, codigo);
    const run = (): void => {
      if (tryFocus()) return;
      listener = () => {
        if (tryFocus() && listener) {
          map.off('sourcedata', listener);
          listener = null;
        }
      };
      map.on('sourcedata', listener);
    };
    if (loadedRef.current) run();
    else map.once('load', run);
    return () => {
      if (listener) {
        map.off('sourcedata', listener);
        listener = null;
      }
    };
  }, [props.focusMunCodigo, props.selectedUf]);

  // Reaplica feature-state municipal quando os totais mudam (faixa ou
  // município). O `pushMunicipioState` faz um wipe único e aplica
  // state só nos municípios cujas features estão em viewport AGORA;
  // os ausentes voltam pendentes no contexto. Continuamos patchando
  // em cada `sourcedata` até cobrir todos os municípios — fix do bug
  // onde Duque de Caxias (e outros) saíam com volume 0 no tooltip
  // porque a feature carregou depois do primeiro setFeatureState.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.selectedUf || !props.municipioTotals) return;
    const totals = props.municipioTotals;
    let patchHandler: ((e: maplibregl.MapSourceDataEvent) => void) | null = null;
    const armPatching = (ctx: ReturnType<typeof pushMunicipioState>): void => {
      if (ctx.pending.size === 0) return;
      patchHandler = (e): void => {
        // Só patcha quando o evento é do source dos polígonos — outros
        // sources (basemap, etc.) não afetam o feature-state municipal.
        if (e.sourceId !== SOURCE_ID) return;
        applyMunicipioStatePatch(map, ctx);
        if (ctx.pending.size === 0 && patchHandler) {
          map.off('sourcedata', patchHandler);
          patchHandler = null;
        }
      };
      map.on('sourcedata', patchHandler);
    };
    const tryPush = (): boolean => {
      const f = map.querySourceFeatures(SOURCE_ID, { sourceLayer: MUN_LAYER });
      if (f.length === 0) return false;
      armPatching(pushMunicipioState(map, totals));
      return true;
    };
    const run = (): void => {
      if (!tryPush()) {
        // Source ainda vazio — espera o primeiro batch de features
        // antes de fazer o wipe + push inicial.
        const initial = (e: maplibregl.MapSourceDataEvent): void => {
          if (e.sourceId !== SOURCE_ID) return;
          if (tryPush()) map.off('sourcedata', initial);
        };
        map.on('sourcedata', initial);
      }
    };
    if (loadedRef.current) run();
    else map.once('load', run);
    return () => {
      if (patchHandler) {
        map.off('sourcedata', patchHandler);
        patchHandler = null;
      }
    };
  }, [props.selectedUf, props.municipioTotals]);

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

/**
 * Centraliza e dá zoom no município indicado. Devolve `true` quando
 * achou a feature e disparou o `easeTo`, `false` quando o município
 * ainda não está em tile carregado (caller deve retry). Filtramos o
 * `querySourceFeatures` pelo `codarea` em vez de varrer todas as
 * features renderizadas — bem mais barato e exato quando a UF inteira
 * está populada.
 */
function focusMunicipio(map: maplibregl.Map, codigo: string): boolean {
  const key6 = codigo.slice(0, 6);
  const features = map.querySourceFeatures(SOURCE_ID, {
    filter: ['==', ['slice', ['to-string', ['get', 'codarea']], 0, 6], key6],
    sourceLayer: MUN_LAYER,
  });
  const match = features[0];
  if (!match) return false;
  const bounds = new maplibregl.LngLatBounds();
  extractCoords(match.geometry).forEach((c) => bounds.extend(c));
  if (bounds.isEmpty()) return false;
  map.easeTo({
    center: bounds.getCenter(),
    duration: 600,
    zoom: Math.max(map.getZoom(), 10),
  });
  return true;
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
