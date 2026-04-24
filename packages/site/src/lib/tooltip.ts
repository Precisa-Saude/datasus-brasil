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
  subtitle: string;
  totalLabel: string;
  totalValue: number;
}): string {
  return `<div style="font-family:'Roboto',system-ui,sans-serif;font-size:0.75rem;min-width:180px;padding:4px 6px">
    <div style="font-weight:600;font-size:0.85rem">${args.name}</div>
    <div style="color:#6b7280;margin-top:2px">${args.subtitle}</div>
    <div style="margin-top:6px"><strong>${formatInt(args.totalValue)}</strong> ${args.totalLabel}</div>
  </div>`;
}
