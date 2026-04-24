/**
 * Registra o protocolo `pmtiles://` no MapLibre GL JS. Idempotente —
 * chame antes de criar o `Map`.
 */

import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

let registered = false;

export function ensurePmtilesProtocol(): void {
  if (registered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  registered = true;
}
