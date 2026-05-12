import { useEffect, useMemo, useRef, useState } from 'react';

import type { AnomalyHit, AnomalyKind } from '@/lib/anomaly';
import { formatCompetencia } from '@/lib/format';

/**
 * Coluna SVG do dumbbell chart — uma linha por hit, com a baseline
 * (cinza) e o valor observado (cor do detector) na mesma escala
 * horizontal, conectados por uma linha. O componente cuida só do
 * gráfico: as colunas de texto (Município | UF | Mês | Exame) ficam
 * em HTML normal no grid pai, e a altura de cada linha do gráfico é
 * `rowHeight` (px) — combinada com a altura da célula HTML faz com
 * que tudo alinhe sem foreignObject ou hacks de aspect-ratio.
 *
 * `ResizeObserver` mede o container e ajusta o `width` do SVG em px,
 * de modo que `viewBox` fique 1:1 (1 unidade = 1 px) e o conteúdo
 * nunca distorça.
 */

export interface AnomalyDumbbellProps {
  formatValue: (v: number) => string;
  hits: AnomalyHit[];
  /** Detector — define a cor do dot observado. */
  kind: AnomalyKind;
  /** Resolução de LOINC → nome do exame pra exibir no tooltip. */
  labelForLoinc: (loinc: string) => string;
  /** Altura por linha (px). Deve bater com a altura das cells HTML
   *  da tabela pra alinhar perfeitamente. */
  rowHeight: number;
}

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

const KIND_COLORS: Record<AnomalyKind, string> = {
  concentration: '#f59e0b',
  'per-capita': '#10b981',
  'price-ratio': '#ef4444',
  spike: '#7c3aed',
};

// Espaço (px) à esquerda do plot pro label numérico do baseline
// (quando o baseline dot fica em scale=0) — caso contrário, o label
// vai pra `x<0` e o navegador corta na borda do SVG.
const PAD_LEFT = 64;
// Espaço (px) à direita do plot pro label numérico do observado.
const PAD_RIGHT = 80;
const AXIS_HEIGHT = 22;
const DOT_R = 5;

function niceTick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

export function AnomalyDumbbell({
  formatValue,
  hits,
  kind,
  labelForLoinc,
  rowHeight,
}: AnomalyDumbbellProps) {
  const color = KIND_COLORS[kind];
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hoveredIdx, setHoveredIdx] = useState<null | number>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.max(280, Math.round(w)));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { max, min, useLog } = useMemo(() => {
    if (hits.length === 0) return { max: 1, min: 0, useLog: false };
    let hi = -Infinity;
    let loPositive = Infinity;
    for (const h of hits) {
      hi = Math.max(hi, h.baseline, h.observed);
      if (h.baseline > 0) loPositive = Math.min(loPositive, h.baseline);
      if (h.observed > 0) loPositive = Math.min(loPositive, h.observed);
    }
    // Usa log quando o range é heavy-tailed (um outlier ofusca os
    // demais). Ignoramos zeros na escolha do floor: senão um único
    // baseline=0 trava o detector em escala linear e os outros
    // valores ficam comprimidos contra a esquerda.
    const safeLow = Number.isFinite(loPositive) ? loPositive : 1;
    const log = hi > 50 && hi / safeLow > 50;
    return { max: hi, min: log ? Math.max(safeLow, 1) : 0, useLog: log };
  }, [hits]);

  const scale = (v: number): number => {
    if (useLog) {
      const lo = Math.log10(Math.max(min, 1));
      const hi = Math.log10(Math.max(max, min + 1));
      const cur = Math.log10(Math.max(v, 1));
      const span = hi - lo;
      if (span <= 0) return 0;
      return Math.max(0, Math.min(1, (cur - lo) / span));
    }
    const span = max - min;
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (v - min) / span));
  };

  const ticks = useMemo(() => {
    if (useLog) {
      const lo = Math.log10(Math.max(min, 1));
      const hi = Math.log10(Math.max(max, min + 1));
      return [0, 1, 2, 3].map((i) => Math.pow(10, lo + ((hi - lo) * i) / 3));
    }
    return [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
  }, [useLog, min, max]);

  const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const xFor = (v: number): number => PAD_LEFT + scale(v) * plotWidth;
  const chartHeight = hits.length * rowHeight;
  const totalHeight = chartHeight + AXIS_HEIGHT;

  const hoveredHit = hoveredIdx !== null ? hits[hoveredIdx] : null;
  const hoveredXObs = hoveredHit ? xFor(hoveredHit.observed) : 0;
  const hoveredY = hoveredIdx !== null ? hoveredIdx * rowHeight + rowHeight / 2 : 0;
  // Posição horizontal do tooltip: alinha próximo ao dot, mas
  // mantém dentro do container quando o dot está perto da borda.
  const tooltipPlacement: 'left' | 'right' = hoveredXObs < width / 2 ? 'right' : 'left';

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        aria-label="Comparação entre baseline/mediana e valor observado"
        height={totalHeight}
        role="img"
        viewBox={`0 0 ${width} ${totalHeight}`}
        width={width}
      >
        {/* Tick gridlines: linhas verticais ao longo de todas as rows */}
        {ticks.map((t, i) => {
          const x = xFor(t);
          return (
            <line
              key={`grid-${i}`}
              className="stroke-border"
              strokeWidth={1}
              x1={x}
              x2={x}
              y1={0}
              y2={chartHeight}
            />
          );
        })}

        {/* Dumbbells: uma g por hit */}
        {hits.map((hit, idx) => {
          const y = idx * rowHeight + rowHeight / 2;
          const xBase = xFor(hit.baseline);
          const xObs = xFor(hit.observed);
          const obsLeft = xObs < xBase;
          // Label do observed: fora do dot, oposto ao baseline.
          const obsAnchor = obsLeft ? 'end' : 'start';
          const obsDx = obsLeft ? -8 : 8;
          // Label do baseline: fora do dot, do lado oposto ao observed.
          const baseAnchor = obsLeft ? 'start' : 'end';
          const baseDx = obsLeft ? 7 : -7;

          return (
            <g key={`hit-${idx}`}>
              <line
                stroke={color}
                strokeOpacity={0.4}
                strokeWidth={1.5}
                x1={xBase}
                x2={xObs}
                y1={y}
                y2={y}
              />
              <circle className="fill-muted-foreground" cx={xBase} cy={y} r={DOT_R * 0.7}>
                <title>{`Baseline/mediana: ${formatValue(hit.baseline)}`}</title>
              </circle>
              <circle
                className="cursor-help"
                cx={xObs}
                cy={y}
                fill={color}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                r={DOT_R}
              />
              {/* Hit-area maior, invisível, pra facilitar o hover no dot. */}
              <circle
                className="cursor-help"
                cx={xObs}
                cy={y}
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                r={DOT_R + 6}
              />
              <text
                className="fill-muted-foreground font-sans"
                dx={baseDx}
                fontSize={11}
                textAnchor={baseAnchor}
                x={xBase}
                y={y + 4}
              >
                {formatValue(hit.baseline)}
              </text>
              <text
                className="font-sans"
                dx={obsDx}
                fill={color}
                fontSize={11}
                fontWeight={600}
                textAnchor={obsAnchor}
                x={xObs}
                y={y + 4}
              >
                {formatValue(hit.observed)}
              </text>
            </g>
          );
        })}

        {/* Eixo X — rótulos numéricos abaixo da última linha */}
        {ticks.map((t, i) => {
          const x = xFor(t);
          return (
            <text
              key={`tick-${i}`}
              className="fill-muted-foreground font-sans"
              fontSize={11}
              textAnchor="middle"
              x={x}
              y={chartHeight + 14}
            >
              {niceTick(t)}
            </text>
          );
        })}
      </svg>

      {hoveredHit ? (
        <div
          className="border-border bg-popover text-popover-foreground pointer-events-none absolute z-10 w-72 rounded-lg border p-3 font-sans text-xs shadow-lg"
          style={{
            left: tooltipPlacement === 'right' ? hoveredXObs + 14 : undefined,
            right: tooltipPlacement === 'left' ? width - hoveredXObs + 14 : undefined,
            top: Math.max(0, hoveredY - 8),
          }}
        >
          <TooltipBody
            color={color}
            formatValue={formatValue}
            hit={hoveredHit}
            kind={kind}
            loincLabel={labelForLoinc(hoveredHit.loinc)}
          />
        </div>
      ) : null}
    </div>
  );
}

interface TooltipBodyProps {
  color: string;
  formatValue: (v: number) => string;
  hit: AnomalyHit;
  kind: AnomalyKind;
  loincLabel: string;
}

function TooltipBody({ color, formatValue, hit, kind, loincLabel }: TooltipBodyProps) {
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
        {volume !== undefined ? (
          <Row label="Volume" value={`${NF_INT.format(volume)} exames`} />
        ) : null}
        {valor !== undefined ? <Row label="Valor total" value={NF_BRL.format(valor)} /> : null}
      </div>

      <DetectorExtras details={details} kind={kind} />

      <p className="text-muted-foreground border-border/60 border-t pt-2 text-[10px]">
        População do município: <span className="italic">dado IBGE pendente</span>
      </p>
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
        {share !== undefined ? (
          <Row
            label="Share"
            value={new Intl.NumberFormat('pt-BR', {
              maximumFractionDigits: 1,
              style: 'percent',
            }).format(share)}
          />
        ) : null}
        {groupTotal !== undefined ? (
          <Row label="Total nacional" value={`${NF_INT.format(groupTotal)} exames`} />
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

export function isDumbbellLogScale(hits: AnomalyHit[]): boolean {
  if (hits.length === 0) return false;
  let hi = -Infinity;
  let loPositive = Infinity;
  for (const h of hits) {
    hi = Math.max(hi, h.baseline, h.observed);
    if (h.baseline > 0) loPositive = Math.min(loPositive, h.baseline);
    if (h.observed > 0) loPositive = Math.min(loPositive, h.observed);
  }
  const safeLow = Number.isFinite(loPositive) ? loPositive : 1;
  return hi > 50 && hi / safeLow > 50;
}
