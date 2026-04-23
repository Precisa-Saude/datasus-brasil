import 'mapbox-gl/dist/mapbox-gl.css';

import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';

import type { MunicipioAggregate } from '@/lib/aggregates';
import { getMapboxToken } from '@/lib/mapbox';

export interface MunicipioMapViewProps {
  competencia: string;
  data: MunicipioAggregate[];
  geoMunicipios: GeoJSON.FeatureCollection;
  loinc: string;
}

/**
 * Choropleth por município dentro de uma UF. Conta com `MapView` já ter
 * renderizado o token-missing state — este componente assume token
 * presente.
 */
export function MunicipioMapView(props: MunicipioMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const token = getMapboxToken();

  useEffect(() => {
    if (!token || !containerRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      zoom: 5,
    });
    mapRef.current = map;

    map.on('load', () => {
      const bounds = new mapboxgl.LngLatBounds();
      for (const feature of props.geoMunicipios.features) {
        extractCoords(feature.geometry).forEach(([lng, lat]) => bounds.extend([lng, lat]));
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 32 });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token, props.geoMunicipios]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = (): void => {
      const filtered = props.data.filter(
        (r) => r.loinc === props.loinc && r.competencia === props.competencia,
      );
      const byMun = new Map(filtered.map((r) => [r.municipioCode, r]));
      const max = Math.max(1, ...filtered.map((r) => r.volumeExames));

      const features = props.geoMunicipios.features.map((f) => {
        const code = (f.properties?.codarea ?? null) as null | string;
        const agg = code ? (byMun.get(code) ?? null) : null;
        return {
          ...f,
          properties: {
            ...f.properties,
            municipio: agg?.municipioNome ?? code ?? '',
            normalizado: agg ? agg.volumeExames / max : 0,
            volume: agg?.volumeExames ?? 0,
          },
        };
      });
      const collection: GeoJSON.FeatureCollection = { features, type: 'FeatureCollection' };

      const src = map.getSource('municipios') as mapboxgl.GeoJSONSource | undefined;
      if (src) {
        src.setData(collection);
        return;
      }
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
          'fill-opacity': 0.78,
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

      const popup = new mapboxgl.Popup({ closeButton: false });
      map.on('mousemove', 'municipios-fill', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = 'pointer';
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family: Roboto, system-ui, sans-serif; font-size: 0.75rem;">
              <strong>${String(f.properties?.municipio ?? '')}</strong><br />
              ${Number(f.properties?.volume ?? 0).toLocaleString('pt-BR')} exames
            </div>`,
          )
          .addTo(map);
      });
      map.on('mouseleave', 'municipios-fill', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [props.data, props.geoMunicipios, props.loinc, props.competencia]);

  if (!token) return null;
  return <div className="h-full min-h-[500px] w-full rounded-lg" ref={containerRef} />;
}

function extractCoords(geom: GeoJSON.Geometry): Array<[number, number]> {
  if (geom.type === 'Polygon') return geom.coordinates.flat() as Array<[number, number]>;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2) as Array<[number, number]>;
  return [];
}
