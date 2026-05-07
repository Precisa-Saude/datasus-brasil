/**
 * HTML templates dos popups do Mapbox. Mantidos como strings porque o
 * `mapboxgl.Popup#setHTML` espera markup direto; React rendering não
 * se aplica no contexto do popup do Mapbox GL JS.
 */

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR');
}

export function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { currency: 'BRL', style: 'currency' });
}

/** Tooltip leve de hover — só uma linha de contexto e o total. */
export function buildOverviewTooltipHtml(args: {
  name: string;
  rank?: null | number;
  rankTotal?: null | number;
  subtitle: string;
  totalLabel: string;
  totalValue: number;
}): string {
  // Rank compensa a perda de calibração da escala log no choropleth:
  // duas UFs com cores parecidas podem estar em posições muito
  // diferentes; mostrar "3/27" remove a ambiguidade.
  const rankLine =
    args.rank && args.rankTotal
      ? `<div style="color:#9ca3af;font-size:0.65rem;margin-top:1px">Rank ${args.rank}/${args.rankTotal}</div>`
      : '';
  return `<div style="font-family:'Roboto',system-ui,sans-serif;font-size:0.75rem;min-width:180px;padding:4px 6px">
    <div style="font-weight:600;font-size:0.85rem">${args.name}</div>
    <div style="color:#6b7280;margin-top:2px">${args.subtitle}</div>
    ${rankLine}
    <div style="margin-top:6px"><strong>${formatInt(args.totalValue)}</strong> ${args.totalLabel}</div>
  </div>`;
}
