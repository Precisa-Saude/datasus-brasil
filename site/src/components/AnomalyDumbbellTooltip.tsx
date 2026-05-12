import type { AnomalyHit, AnomalyKind, PopulationLookup } from '@/lib/anomaly';
import { formatCompetencia } from '@/lib/format';

/**
 * Conteúdo flutuante mostrado em hover de um dot do dumbbell. Vive
 * num arquivo separado pra manter `AnomalyDumbbell.tsx` abaixo do
 * limite de `max-lines` do ESLint e isolar a lógica de formatação.
 *
 * `TooltipPortal` faz o `position: fixed` ancorado nas coords do dot
 * (passadas do componente pai, capturadas no `mouseEnter` via
 * `getBoundingClientRect()`). `TooltipBody` é o conteúdo em si.
 */

const NF_INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const NF_BRL = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  maximumFractionDigits: 2,
  style: 'currency',
});
const NF_PCT = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
  style: 'percent',
});
const NF_SHARE = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
  style: 'percent',
});

export interface AnomalyTooltipProps {
  color: string;
  dotX: number;
  dotY: number;
  formatValue: (v: number) => string;
  hit: AnomalyHit;
  kind: AnomalyKind;
  loincLabel: string;
  populationLookup: null | PopulationLookup;
}

export function AnomalyTooltip({
  color,
  dotX,
  dotY,
  formatValue,
  hit,
  kind,
  loincLabel,
  populationLookup,
}: AnomalyTooltipProps) {
  // Decide o lado com base na posição do dot na **viewport** —
  // garante que o tooltip nunca abre pra fora da janela.
  const viewportW = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const placeRight = dotX < viewportW / 2;
  const style: React.CSSProperties = {
    top: Math.max(8, dotY - 8),
    ...(placeRight ? { left: dotX + 14 } : { right: Math.max(8, viewportW - dotX + 14) }),
  };
  return (
    <div
      className="border-border bg-popover text-popover-foreground pointer-events-none fixed z-50 w-72 rounded-lg border p-3 font-sans text-xs shadow-lg"
      style={style}
    >
      <TooltipBody
        color={color}
        formatValue={formatValue}
        hit={hit}
        kind={kind}
        loincLabel={loincLabel}
        populationLookup={populationLookup}
      />
    </div>
  );
}

interface TooltipBodyProps {
  color: string;
  formatValue: (v: number) => string;
  hit: AnomalyHit;
  kind: AnomalyKind;
  loincLabel: string;
  populationLookup: null | PopulationLookup;
}

function TooltipBody({
  color,
  formatValue,
  hit,
  kind,
  loincLabel,
  populationLookup,
}: TooltipBodyProps) {
  const { details } = hit;
  const valor = details['valorAprovadoBRL'];
  const volume = details['volumeExames'];
  // Variação percentual = (observado − baseline) / baseline. Faz
  // sentido pra spike e price-ratio; pra concentração, observed/
  // baseline já são share — a comparação direta com o limiar (0.2)
  // é menos significativa, então omitimos %.
  const showPercent = kind === 'spike' || kind === 'price-ratio';
  const percentChange =
    showPercent && hit.baseline > 0 ? (hit.observed - hit.baseline) / hit.baseline : null;

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p className="font-semibold tracking-tight">
          {hit.municipioNome} <span className="text-muted-foreground">· {hit.ufSigla}</span>
        </p>
        <p className="text-muted-foreground">
          {formatCompetencia(hit.competencia)} · {loincLabel}
        </p>
      </div>

      <div className="border-border/60 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2">
        <Row label="Observado" value={formatValue(hit.observed)} valueColor={color} />
        <Row label="Baseline" value={formatValue(hit.baseline)} />
        {percentChange !== null ? (
          <Row label="Variação" value={NF_PCT.format(percentChange)} valueColor={color} />
        ) : null}
        {volume !== undefined ? <Row label="Volume" value={NF_INT.format(volume)} /> : null}
        {valor !== undefined ? <Row label="Valor total" value={NF_BRL.format(valor)} /> : null}
        {/* Valor unitário (R$/exame) — útil em spike/concentração, onde
            o observed é volume e o valor total fica abstrato. Em
            price-ratio o observed já é o ratio, então omitimos. */}
        {kind !== 'price-ratio' && valor !== undefined && volume !== undefined && volume > 0 ? (
          <Row label="Valor unitário" value={`${NF_BRL.format(valor / volume)}/exame`} />
        ) : null}
      </div>

      <DetectorExtras details={details} kind={kind} />

      <PopulationRow hit={hit} populationLookup={populationLookup} />
    </div>
  );
}

function PopulationRow({
  hit,
  populationLookup,
}: {
  hit: AnomalyHit;
  populationLookup: null | PopulationLookup;
}) {
  const year = Number(hit.competencia.slice(0, 4));
  const population =
    populationLookup && Number.isFinite(year)
      ? populationLookup(hit.municipioCode, year)
      : undefined;
  const volume = hit.details['volumeExames'];
  // Quando temos volume + população, mostra também exames por 1k
  // habitantes — métrica âncora do per-capita.
  const per1k =
    population !== undefined && volume !== undefined && population > 0
      ? (volume * 1000) / population
      : null;
  return (
    <div className="border-border/60 border-t pt-2">
      <p className="text-muted-foreground flex items-baseline justify-between gap-2 text-[11px]">
        <span>População {Number.isFinite(year) ? `(${year})` : ''}</span>
        <span className="text-foreground font-medium tabular-nums">
          {population !== undefined ? (
            NF_INT.format(population)
          ) : (
            <span className="text-muted-foreground italic">indisponível</span>
          )}
        </span>
      </p>
      {per1k !== null ? (
        <p className="text-muted-foreground flex items-baseline justify-between gap-2 text-[11px]">
          <span>Exames por 1k hab.</span>
          <span className="text-foreground font-medium tabular-nums">{per1k.toFixed(1)}</span>
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}

function DetectorExtras({ details, kind }: { details: Record<string, number>; kind: AnomalyKind }) {
  if (kind === 'spike') {
    const z = details['z'];
    const baselineN = details['baselineN'];
    const windowMonths = details['windowMonths'];
    return (
      <div className="border-border/60 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2">
        {z !== undefined ? <Row label="z robusto" value={z.toFixed(1)} /> : null}
        {windowMonths !== undefined && baselineN !== undefined ? (
          <Row
            label="Baseline"
            value={`${NF_INT.format(baselineN)}/${NF_INT.format(windowMonths)} meses`}
          />
        ) : null}
      </div>
    );
  }
  if (kind === 'concentration') {
    const share = details['share'];
    const groupTotal = details['groupTotal'];
    return (
      <div className="border-border/60 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2">
        {share !== undefined ? <Row label="Share" value={NF_SHARE.format(share)} /> : null}
        {groupTotal !== undefined ? (
          <Row label="Total nacional" value={NF_INT.format(groupTotal)} />
        ) : null}
      </div>
    );
  }
  if (kind === 'price-ratio') {
    const q1 = details['q1'];
    const q3 = details['q3'];
    const groupN = details['groupN'];
    return (
      <div className="border-border/60 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2">
        {q1 !== undefined && q3 !== undefined ? (
          <Row label="Q1–Q3 nacional" value={`${NF_BRL.format(q1)} – ${NF_BRL.format(q3)}`} />
        ) : null}
        {groupN !== undefined ? (
          <Row label="Municípios" value={`${NF_INT.format(groupN)} no ano`} />
        ) : null}
      </div>
    );
  }
  return null;
}
