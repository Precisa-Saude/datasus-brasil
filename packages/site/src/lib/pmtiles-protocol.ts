/**
 * Registra o protocolo `pmtiles://` no Mapbox GL JS. Idempotente —
 * chame do ponto de entrada do app.
 */

import mapboxgl from 'mapbox-gl';
import { Protocol } from 'pmtiles';

interface MapboxWithProtocol {
  addProtocol: (name: string, loader: Protocol['tile']) => void;
}

let registered = false;

export function ensurePmtilesProtocol(): void {
  if (registered) return;
  const protocol = new Protocol();
  // `addProtocol` existe em `mapbox-gl` v2+ mas os types oficiais não
  // expõem — cast pontual em vez de derrubar o strict do TS.
  (mapboxgl as unknown as MapboxWithProtocol).addProtocol('pmtiles', protocol.tile);
  registered = true;
}
