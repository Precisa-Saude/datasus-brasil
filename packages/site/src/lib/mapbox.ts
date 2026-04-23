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

export const BRAZIL_CENTER: [number, number] = [-52, -14];
export const BRAZIL_ZOOM = 3.4;
