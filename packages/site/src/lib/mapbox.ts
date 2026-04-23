/**
 * Acesso seguro ao token do Mapbox.
 *
 * `VITE_MAPBOX_TOKEN` é um pseudo-secret (conforme AGENTS.md — vai no
 * bundle do browser por design). Sem ele, o site renderiza uma
 * mensagem de configuração em vez de explodir no console.
 */

export function getMapboxToken(): null | string {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token || token.trim() === '') return null;
  return token;
}

/**
 * Brasil continental + Trindade/Martim Vaz, com uma folga pra não
 * cortar o contorno em viewports normais. Formato aceito por
 * `Map#fitBounds`: [[minLng, minLat], [maxLng, maxLat]].
 */
export const BRAZIL_BOUNDS: [[number, number], [number, number]] = [
  [-76, -35],
  [-32, 7],
];

/** Padding default do fitBounds — dá uma gutter visual no contêiner. */
export const BRAZIL_FIT_PADDING = 32;
