const MESES_ABBR_PT = [
  'Jan.',
  'Fev.',
  'Mar.',
  'Abr.',
  'Mai.',
  'Jun.',
  'Jul.',
  'Ago.',
  'Set.',
  'Out.',
  'Nov.',
  'Dez.',
] as const;

export function formatCompetencia(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const mi = Number(m) - 1;
  const label = MESES_ABBR_PT[mi];
  if (!y || !label) return yyyymm;
  return `${label} ${y}`;
}

import type { CompetenciaRange } from './aggregates';

export function formatCompetenciaRange(range: CompetenciaRange): string {
  if (range.from === range.to) return formatCompetencia(range.from);
  return `${formatCompetencia(range.from)} – ${formatCompetencia(range.to)}`;
}
