/**
 * Constantes do mapa. Nome do arquivo preservado por histórico — o
 * renderizador agora é MapLibre GL JS (fork open-source do
 * mapbox-gl v1/v2 que não removeu `addProtocol`).
 */

/** Sul-up, zoom centrado no Brasil continental. */
export const BRAZIL_BOUNDS: [[number, number], [number, number]] = [
  [-76, -35],
  [-32, 7],
];

/**
 * Fronteira rígida de pan/zoom — impede o usuário de sair do Brasil
 * e evita artefatos de world-wrap horizontal da projeção Mercator.
 */
export const BRAZIL_MAX_BOUNDS: [[number, number], [number, number]] = [
  [-90, -40],
  [-25, 12],
];

export const BRAZIL_FIT_PADDING = 32;

/**
 * Style URL público (Protomaps basemaps). Open source, sem key,
 * renderiza OSM com paleta clara neutra — adequado ao choropleth
 * violeta no topo.
 */
export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
