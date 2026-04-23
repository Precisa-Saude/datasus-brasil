import 'mapbox-gl/dist/mapbox-gl.css';

import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';

import type { UfAggregate } from '@/lib/aggregates';
import { BRAZIL_CENTER, BRAZIL_ZOOM, getMapboxToken } from '@/lib/mapbox';

export interface UfChoroplethProps {
  /** Competência ISO `"YYYY-MM"` — filtra o agregado. */
  competencia: string;
  /** Agregado completo para o ano corrente. */
  data: UfAggregate[];
  /** GeoJSON com as 27 UFs do Brasil. */
  geoUF: GeoJSON.FeatureCollection;
  /** Biomarcador LOINC selecionado — filtra as células do agregado. */
  loinc: string;
  /** Callback quando o usuário clica numa UF (para drill-down). */
  onUfClick?: (ufSigla: string) => void;
}

/**
 * Choropleth nacional por UF com Mapbox GL JS. Renderiza uma mensagem
 * amigável quando `VITE_MAPBOX_TOKEN` não está configurado, em vez de
 * lançar no console.
 */
export function MapView(props: UfChoroplethProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const token = getMapboxToken();

  useEffect(() => {
    if (!token || !containerRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      center: BRAZIL_CENTER,
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      zoom: BRAZIL_ZOOM,
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = (): void => {
      const filtered = props.data.filter(
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
        map.on('click', 'uf-fill', (e) => {
          const feature = e.features?.[0];
          const sigla = feature?.properties?.sigla ?? feature?.properties?.sigla_uf;
          if (typeof sigla === 'string') props.onUfClick?.(sigla);
        });
        map.on('mouseenter', 'uf-fill', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'uf-fill', () => {
          map.getCanvas().style.cursor = '';
        });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [props.data, props.geoUF, props.loinc, props.competencia, props.onUfClick, props]);

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

  return <div className="h-full min-h-[500px] w-full rounded-lg" ref={containerRef} />;
}
