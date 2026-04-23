import 'mapbox-gl/dist/mapbox-gl.css';

import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';

import type { MunicipioAggregate, UfAggregate } from '@/lib/aggregates';
import { BRAZIL_BOUNDS, BRAZIL_FIT_PADDING, getMapboxToken } from '@/lib/mapbox';

export interface BrasilMapProps {
  /** UFs com dados municipais disponíveis. */
  availableUFs: readonly string[];
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
  /** Callback quando uma UF clicável é clicada. */
  onUfClick: (ufSigla: string) => void;
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
  const loadedRef = useRef(false);
  const clickHandlerRef = useRef<((e: mapboxgl.MapLayerMouseEvent) => void) | null>(null);
  const mousemoveHandlerRef = useRef<((e: mapboxgl.MapLayerMouseEvent) => void) | null>(null);
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

    const apply = (): void => {
      const filtered = props.ufData.filter(
        (r) => r.loinc === props.loinc && r.competencia === props.competencia,
      );
      const byUf = new Map(filtered.map((r) => [r.ufSigla, r.volumeExames]));
      const max = Math.max(1, ...filtered.map((r) => r.volumeExames));

      const features = props.geoUF.features.map((f) => {
        const sigla = (f.properties?.sigla ?? f.properties?.sigla_uf ?? null) as null | string;
        return {
          ...f,
          properties: {
            ...f.properties,
            normalizado: sigla && byUf.has(sigla) ? (byUf.get(sigla) ?? 0) / max : 0,
            volume: sigla ? (byUf.get(sigla) ?? 0) : 0,
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

      // Handlers dependem de `availableUFs` e `onUfClick` atualizados —
      // removo os antigos e registro os novos a cada render.
      const availableSet = new Set(props.availableUFs);
      if (clickHandlerRef.current) map.off('click', 'uf-fill', clickHandlerRef.current);
      if (mousemoveHandlerRef.current) map.off('mousemove', 'uf-fill', mousemoveHandlerRef.current);
      const onClick = (e: mapboxgl.MapLayerMouseEvent): void => {
        const feature = e.features?.[0];
        const sigla = feature?.properties?.sigla ?? feature?.properties?.sigla_uf;
        if (typeof sigla !== 'string' || !availableSet.has(sigla)) return;
        props.onUfClick(sigla);
      };
      const onMousemove = (e: mapboxgl.MapLayerMouseEvent): void => {
        const feature = e.features?.[0];
        const sigla = feature?.properties?.sigla ?? feature?.properties?.sigla_uf;
        map.getCanvas().style.cursor =
          typeof sigla === 'string' && availableSet.has(sigla) ? 'pointer' : 'not-allowed';
      };
      map.on('click', 'uf-fill', onClick);
      map.on('mousemove', 'uf-fill', onMousemove);
      map.on('mouseleave', 'uf-fill', () => {
        map.getCanvas().style.cursor = '';
      });
      clickHandlerRef.current = onClick;
      mousemoveHandlerRef.current = onMousemove;
    };

    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [
    props.ufData,
    props.geoUF,
    props.loinc,
    props.competencia,
    props.availableUFs,
    props.onUfClick,
    props,
  ]);

  // Renderiza/atualiza/remove o layer municipal, e anima entre UF e Brasil.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = (): void => {
      const drill = props.drilldown;
      if (drill) {
        const filtered = drill.municipioData.filter(
          (r) => r.loinc === props.loinc && r.competencia === props.competencia,
        );
        // IBGE `codarea` tem 7 dígitos (com DV), SIA `PA_UFMUN` tem 6
        // (sem DV). Indexamos truncado p/ bater nos dois sentidos.
        const byMun = new Map(filtered.map((r) => [r.municipioCode.slice(0, 6), r]));
        const maxM = Math.max(1, ...filtered.map((r) => r.volumeExames));

        const features = drill.geoMunicipios.features.map((f) => {
          const code = (f.properties?.codarea ?? null) as null | string;
          const key6 = typeof code === 'string' ? code.slice(0, 6) : null;
          const agg = key6 ? (byMun.get(key6) ?? null) : null;
          return {
            ...f,
            properties: {
              ...f.properties,
              municipio: agg?.municipioNome ?? code ?? '',
              normalizado: agg ? agg.volumeExames / maxM : 0,
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
              'fill-color': [
                'interpolate',
                ['linear'],
                ['get', 'normalizado'],
                0,
                '#eef8f0',
                0.25,
                '#b8e2c7',
                0.5,
                '#5eb880',
                0.75,
                '#2a8f4c',
                1,
                '#14532d',
              ],
              'fill-opacity': 0.82,
            },
            source: 'municipios',
            type: 'fill',
          });
          map.addLayer({
            id: 'municipios-outline',
            paint: { 'line-color': '#14532d', 'line-width': 0.4 },
            source: 'municipios',
            type: 'line',
          });
        }

        // Mantém o contorno do Brasil visível como referência, mas
        // dessatura o preenchimento pra não competir com o municipal.
        if (map.getLayer('uf-fill')) map.setPaintProperty('uf-fill', 'fill-opacity', 0.15);
        if (map.getLayer('uf-outline')) {
          map.setLayoutProperty('uf-outline', 'visibility', 'visible');
        }

        const ufBounds = new mapboxgl.LngLatBounds();
        for (const feature of drill.geoMunicipios.features) {
          extractCoords(feature.geometry).forEach(([lng, lat]) => ufBounds.extend([lng, lat]));
        }
        if (!ufBounds.isEmpty()) {
          map.fitBounds(ufBounds, { bearing: 180, duration: 1200, padding: 40 });
        }
      } else {
        // Volta ao Brasil: esconde municipal, restaura opacidade da UF.
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
      }
    };

    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [props.drilldown, props.loinc, props.competencia]);

  if (!token) {
    return (
      <div className="border-border bg-muted/30 text-muted-foreground flex h-full min-h-[400px] items-center justify-center rounded-lg border p-8 text-center">
        <div className="max-w-md space-y-3">
          <h3 className="font-sans text-base font-semibold">Token do Mapbox não configurado</h3>
          <p className="text-sm">
            Defina <code className="font-mono text-xs">VITE_MAPBOX_TOKEN</code> num arquivo{' '}
            <code className="font-mono text-xs">.env.local</code> dentro de{' '}
            <code className="font-mono text-xs">packages/site/</code> para habilitar o mapa.
          </p>
          <p className="text-xs">
            Tokens gratuitos disponíveis em{' '}
            <a
              className="underline"
              href="https://account.mapbox.com/"
              rel="noreferrer"
              target="_blank"
            >
              account.mapbox.com
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return <div className="h-full w-full" ref={containerRef} />;
}

function extractCoords(geom: GeoJSON.Geometry): Array<[number, number]> {
  if (geom.type === 'Polygon') return geom.coordinates.flat() as Array<[number, number]>;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2) as Array<[number, number]>;
  return [];
}
