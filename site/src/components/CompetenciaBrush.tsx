import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CompetenciaRange } from '@/lib/aggregates';
import { formatCompetencia, formatCompetenciaRange } from '@/lib/format';

export interface CompetenciaBrushProps {
  competencias: string[];
  value: CompetenciaRange;
  /** Volume nacional por competência. Mapas faltantes contam como 0. */
  volumeByCompetencia: Map<string, number>;
  onChange: (range: CompetenciaRange) => void;
}

/**
 * Faixa mínima da seleção: `to > from` (start e end devem diferir).
 * Em índices, isso é `endIdx - startIdx >= 1` → 2 meses adjacentes.
 */
const MIN_SPAN = 1;

type DragMode = null | 'end' | 'middle' | 'start';

interface DragState {
  endIdx: number;
  mode: Exclude<DragMode, null>;
  /** Posição em índice fracionário no momento do pointerdown — usado
   *  pelo modo 'middle' pra preservar deslocamento. */
  pointerIdxAtDown: number;
  /** Índice (start ou end) onde o pointer agarrou o handle, em meses inteiros. */
  startIdx: number;
}

const HISTOGRAM_HEIGHT = 72;
const HANDLE_WIDTH = 8;
const HANDLE_OVERFLOW = 4;
const YEAR_LABEL_MIN_PX = 28;

interface YearTick {
  idx: number;
  label: string;
  x: number;
}

function computeYearTicks(months: string[], idxToX: (idx: number) => number): YearTick[] {
  const ticks: YearTick[] = [];
  let lastX = -Infinity;
  for (let i = 0; i < months.length; i += 1) {
    const c = months[i] as string;
    if (!c.endsWith('-01')) continue;
    const x = idxToX(i);
    if (x - lastX < YEAR_LABEL_MIN_PX) continue;
    ticks.push({ idx: i, label: c.slice(0, 4), x });
    lastX = x;
  }
  return ticks;
}

export function CompetenciaBrush({
  competencias,
  onChange,
  value,
  volumeByCompetencia,
}: CompetenciaBrushProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const dragRef = useRef<DragState | null>(null);

  // Estado local da janela durante o drag — mantém o brush responsivo
  // (Falcon-like), evitando que cada pixel mexido propague pra URL e
  // dispare refetch + recolor do mapa. `null` = sem drag em curso e o
  // valor canônico é o `value` do prop.
  const [draftRange, setDraftRange] = useState<CompetenciaRange | null>(null);
  const effectiveValue = draftRange ?? value;

  // ResizeObserver pra acompanhar largura do container; o histograma e o
  // brush são desenhados em SVG via coordenadas absolutas em px.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const months = competencias;
  const n = months.length;
  const maxIdx = Math.max(0, n - 1);
  const fromIdx = Math.max(0, months.indexOf(effectiveValue.from));
  const toIdx = Math.max(fromIdx + MIN_SPAN, months.indexOf(effectiveValue.to));

  const maxVolume = useMemo(() => {
    let m = 0;
    for (const c of months) m = Math.max(m, volumeByCompetencia.get(c) ?? 0);
    return m || 1;
  }, [months, volumeByCompetencia]);

  const barAreaWidth = Math.max(1, width);
  const barStep = n > 0 ? barAreaWidth / n : 0;
  const histogramTop = 0;
  const svgHeight = HISTOGRAM_HEIGHT;

  const idxToX = useCallback((idx: number) => idx * barStep + barStep / 2, [barStep]);
  const xToIdx = useCallback(
    (x: number) => {
      if (barStep <= 0) return 0;
      return Math.max(0, Math.min(maxIdx, Math.round((x - barStep / 2) / barStep)));
    },
    [barStep, maxIdx],
  );

  const updateDraft = useCallback(
    (nextFrom: number, nextTo: number) => {
      const from = months[nextFrom];
      const to = months[nextTo];
      if (!from || !to) return;
      setDraftRange((prev) => {
        if (prev && prev.from === from && prev.to === to) return prev;
        return { from, to };
      });
    },
    [months],
  );

  const commit = useCallback(() => {
    const draft = draftRange;
    setDraftRange(null);
    if (!draft) return;
    if (draft.from === value.from && draft.to === value.to) return;
    onChange(draft);
  }, [draftRange, value.from, value.to, onChange]);

  // Refs pra que listeners no `window` enxerguem sempre os callbacks
  // mais recentes sem precisar reanexar. Reanexar a cada drag move
  // adiciona overhead e quebra `setPointerCapture`/touch tracking.
  const moveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const upRef = useRef<((e: PointerEvent) => void) | null>(null);

  useEffect(() => {
    moveRef.current = (e: PointerEvent) => {
      const drag = dragRef.current;
      const el = containerRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (drag.mode === 'start') {
        const idx = Math.min(drag.endIdx - MIN_SPAN, xToIdx(x));
        updateDraft(Math.max(0, idx), drag.endIdx);
      } else if (drag.mode === 'end') {
        const idx = Math.max(drag.startIdx + MIN_SPAN, xToIdx(x));
        updateDraft(drag.startIdx, Math.min(maxIdx, idx));
      } else {
        const span = drag.endIdx - drag.startIdx;
        const pointerIdx = barStep > 0 ? (x - barStep / 2) / barStep : 0;
        const delta = pointerIdx - drag.pointerIdxAtDown;
        let nextStart = Math.round(drag.startIdx + delta);
        nextStart = Math.max(0, Math.min(maxIdx - span, nextStart));
        updateDraft(nextStart, nextStart + span);
      }
    };
    upRef.current = () => {
      dragRef.current = null;
      commit();
    };
  }, [xToIdx, barStep, maxIdx, updateDraft, commit]);

  const startDrag = useCallback(
    (mode: Exclude<DragMode, null>, e: React.PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pointerIdxAtDown = barStep > 0 ? (x - barStep / 2) / barStep : 0;
      dragRef.current = { endIdx: toIdx, mode, pointerIdxAtDown, startIdx: fromIdx };
      // Inicia o draft no estado atual pra que `commit` reconheça
      // mudança mesmo se o usuário só clicar (sem mover).
      setDraftRange({ from: months[fromIdx] as string, to: months[toIdx] as string });
      const onMove = (ev: PointerEvent): void => moveRef.current?.(ev);
      const onUp = (ev: PointerEvent): void => {
        upRef.current?.(ev);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [fromIdx, toIdx, barStep, months],
  );

  const handleKey = useCallback(
    (which: 'end' | 'start', e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 12 : 1;
      let next: { from: number; to: number } | null = null;
      if (e.key === 'ArrowLeft') {
        next =
          which === 'start'
            ? { from: Math.max(0, fromIdx - step), to: toIdx }
            : { from: fromIdx, to: Math.max(fromIdx + MIN_SPAN, toIdx - step) };
      } else if (e.key === 'ArrowRight') {
        next =
          which === 'start'
            ? { from: Math.min(toIdx - MIN_SPAN, fromIdx + step), to: toIdx }
            : { from: fromIdx, to: Math.min(maxIdx, toIdx + step) };
      }
      if (!next) return;
      e.preventDefault();
      if (next.from === fromIdx && next.to === toIdx) return;
      const from = months[next.from];
      const to = months[next.to];
      if (from && to) onChange({ from, to });
    },
    [fromIdx, toIdx, maxIdx, months, onChange],
  );

  const startX = idxToX(fromIdx) - barStep / 2;
  const endX = idxToX(toIdx) + barStep / 2;
  const windowW = Math.max(barStep, endX - startX);

  // Rótulo flutuante: posiciona no centro da janela; clampa nas bordas
  // pra não estourar o container.
  const labelCenterX = (startX + endX) / 2;
  const labelStyle: React.CSSProperties =
    labelCenterX < width * 0.06
      ? { left: 0 }
      : labelCenterX > width * 0.94
        ? { right: 0 }
        : { left: `${labelCenterX}px`, transform: 'translateX(-50%)' };

  const yearTicks = useMemo(() => computeYearTicks(months, idxToX), [months, idxToX]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground font-sans text-[11px] font-medium tracking-wide uppercase">
        Competência
      </span>
      <div className="relative pt-6" ref={containerRef}>
        <span
          className="text-foreground pointer-events-none absolute top-0 font-sans text-sm font-semibold tabular-nums whitespace-nowrap"
          style={labelStyle}
        >
          {formatCompetenciaRange(effectiveValue)}
        </span>
        <svg
          className="block w-full select-none overflow-visible"
          height={svgHeight}
          style={{ touchAction: 'none' }}
          width={width}
        >
          {/* Histograma: barras dentro da janela em primary, fora em
              muted. A janela do brush é a sobreposição translúcida em
              cima dessa camada. */}
          {months.map((c, i) => {
            const v = volumeByCompetencia.get(c) ?? 0;
            const h = v > 0 ? Math.max(1, (v / maxVolume) * HISTOGRAM_HEIGHT) : 0;
            const inside = i >= fromIdx && i <= toIdx;
            const x = i * barStep;
            const barW = Math.max(1, barStep - 1);
            return (
              <rect
                fill={inside ? 'var(--primary)' : 'var(--muted-foreground)'}
                fillOpacity={inside ? 1 : 0.25}
                height={h}
                key={c}
                pointerEvents="none"
                width={barW}
                x={x}
                y={histogramTop + (HISTOGRAM_HEIGHT - h)}
              />
            );
          })}

          {/* Janela ativa do brush — sobrepõe o histograma e captura
              o drag de mover (cinza translúcido pra não competir com
              a cor das barras dentro). */}
          <rect
            fill="var(--primary)"
            fillOpacity={0.08}
            height={HISTOGRAM_HEIGHT}
            onPointerDown={(e) => startDrag('middle', e)}
            stroke="var(--primary)"
            strokeWidth={1}
            style={{ cursor: 'grab' }}
            width={windowW}
            x={startX}
            y={histogramTop}
          />

          {/* Handle esquerdo — barra vertical do tamanho do histograma */}
          <rect
            aria-label="Início da faixa"
            aria-valuemax={toIdx - MIN_SPAN}
            aria-valuemin={0}
            aria-valuenow={fromIdx}
            aria-valuetext={formatCompetencia(effectiveValue.from)}
            fill="var(--background)"
            height={HISTOGRAM_HEIGHT + HANDLE_OVERFLOW * 2}
            onKeyDown={(e) => handleKey('start', e)}
            onPointerDown={(e) => startDrag('start', e)}
            role="slider"
            rx={2}
            ry={2}
            stroke="var(--primary)"
            strokeWidth={2}
            style={{ cursor: 'ew-resize', outline: 'none' }}
            tabIndex={0}
            width={HANDLE_WIDTH}
            x={startX - HANDLE_WIDTH / 2}
            y={histogramTop - HANDLE_OVERFLOW}
          />
          {/* Handle direito */}
          <rect
            aria-label="Fim da faixa"
            aria-valuemax={maxIdx}
            aria-valuemin={fromIdx + MIN_SPAN}
            aria-valuenow={toIdx}
            aria-valuetext={formatCompetencia(effectiveValue.to)}
            fill="var(--background)"
            height={HISTOGRAM_HEIGHT + HANDLE_OVERFLOW * 2}
            onKeyDown={(e) => handleKey('end', e)}
            onPointerDown={(e) => startDrag('end', e)}
            role="slider"
            rx={2}
            ry={2}
            stroke="var(--primary)"
            strokeWidth={2}
            style={{ cursor: 'ew-resize', outline: 'none' }}
            tabIndex={0}
            width={HANDLE_WIDTH}
            x={endX - HANDLE_WIDTH / 2}
            y={histogramTop - HANDLE_OVERFLOW}
          />
        </svg>

        {/* Labels de início de ano — posicionadas em px (não em %) e
            esparsadas pra evitar sobreposição quando há muitos anos. */}
        <div aria-hidden="true" className="relative mt-1 h-3">
          {yearTicks.map((t) => {
            const align = t.x < 12 ? 'start' : t.x > width - 12 ? 'end' : 'center';
            const style: React.CSSProperties =
              align === 'start'
                ? { left: 0 }
                : align === 'end'
                  ? { right: 0 }
                  : { left: `${t.x}px`, transform: 'translateX(-50%)' };
            return (
              <span
                className="text-muted-foreground absolute top-0 font-sans text-[10px] tabular-nums"
                key={t.idx}
                style={style}
              >
                {t.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
