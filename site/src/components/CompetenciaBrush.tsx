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

const HISTOGRAM_HEIGHT = 56;
const TRACK_HEIGHT = 12;
const GAP = 4;
const HANDLE_WIDTH = 10;

export function CompetenciaBrush({
  competencias,
  onChange,
  value,
  volumeByCompetencia,
}: CompetenciaBrushProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const dragRef = useRef<DragState | null>(null);

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
  const max = Math.max(0, n - 1);
  const fromIdx = Math.max(0, months.indexOf(value.from));
  const toIdx = Math.max(fromIdx + MIN_SPAN, months.indexOf(value.to));

  const maxVolume = useMemo(() => {
    let m = 0;
    for (const c of months) m = Math.max(m, volumeByCompetencia.get(c) ?? 0);
    return m || 1;
  }, [months, volumeByCompetencia]);

  const barAreaWidth = Math.max(1, width);
  const barStep = n > 0 ? barAreaWidth / n : 0;
  const histogramTop = 0;
  const trackTop = HISTOGRAM_HEIGHT + GAP;

  // Conversão px ↔ índice. Usa o centro de cada faixa de mês como ponto
  // âncora pra que `Math.round` faça o snap correto.
  const idxToX = useCallback((idx: number) => idx * barStep + barStep / 2, [barStep]);
  const xToIdx = useCallback(
    (x: number) => {
      if (barStep <= 0) return 0;
      return Math.max(0, Math.min(max, Math.round((x - barStep / 2) / barStep)));
    },
    [barStep, max],
  );

  const emit = useCallback(
    (nextFrom: number, nextTo: number) => {
      if (nextFrom === fromIdx && nextTo === toIdx) return;
      const from = months[nextFrom];
      const to = months[nextTo];
      if (!from || !to) return;
      onChange({ from, to });
    },
    [months, fromIdx, toIdx, onChange],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      const el = containerRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (drag.mode === 'start') {
        const idx = Math.min(drag.endIdx - MIN_SPAN, xToIdx(x));
        emit(Math.max(0, idx), drag.endIdx);
      } else if (drag.mode === 'end') {
        const idx = Math.max(drag.startIdx + MIN_SPAN, xToIdx(x));
        emit(drag.startIdx, Math.min(max, idx));
      } else {
        // 'middle' — preserva largura da janela, clamp nas bordas.
        const span = drag.endIdx - drag.startIdx;
        // Posição do pointer em índice fracionário, sem snap (snap só na
        // posição final do start, pra manter a largura inteira).
        const pointerIdx = barStep > 0 ? (x - barStep / 2) / barStep : 0;
        const delta = pointerIdx - drag.pointerIdxAtDown;
        let nextStart = Math.round(drag.startIdx + delta);
        nextStart = Math.max(0, Math.min(max - span, nextStart));
        emit(nextStart, nextStart + span);
      }
    },
    [emit, xToIdx, barStep, max],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  }, [handlePointerMove]);

  const startDrag = useCallback(
    (mode: Exclude<DragMode, null>, e: React.PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pointerIdxAtDown = barStep > 0 ? (x - barStep / 2) / barStep : 0;
      dragRef.current = { endIdx: toIdx, mode, pointerIdxAtDown, startIdx: fromIdx };
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [fromIdx, toIdx, barStep, handlePointerMove, handlePointerUp],
  );

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    },
    [handlePointerMove, handlePointerUp],
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
            : { from: fromIdx, to: Math.min(max, toIdx + step) };
      }
      if (next) {
        e.preventDefault();
        emit(next.from, next.to);
      }
    },
    [fromIdx, toIdx, max, emit],
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
          {formatCompetenciaRange(value)}
        </span>
        <svg
          className="block w-full select-none"
          height={HISTOGRAM_HEIGHT + GAP + TRACK_HEIGHT}
          style={{ touchAction: 'none' }}
          width={width}
        >
          {/* Barras do histograma */}
          {months.map((c, i) => {
            const v = volumeByCompetencia.get(c) ?? 0;
            const h = Math.max(1, (v / maxVolume) * HISTOGRAM_HEIGHT);
            const inside = i >= fromIdx && i <= toIdx;
            const x = i * barStep;
            const barW = Math.max(1, barStep - 1);
            return (
              <rect
                key={c}
                fill={inside ? 'var(--primary)' : 'var(--muted-foreground)'}
                fillOpacity={inside ? 0.85 : 0.25}
                height={h}
                width={barW}
                x={x}
                y={histogramTop + (HISTOGRAM_HEIGHT - h)}
              />
            );
          })}

          {/* Track de fundo do brush */}
          <rect
            fill="var(--secondary)"
            height={TRACK_HEIGHT}
            rx={TRACK_HEIGHT / 2}
            ry={TRACK_HEIGHT / 2}
            width={barAreaWidth}
            x={0}
            y={trackTop}
          />

          {/* Janela ativa (drag = move) */}
          <rect
            fill="var(--primary)"
            fillOpacity={0.25}
            height={TRACK_HEIGHT}
            onPointerDown={(e) => startDrag('middle', e)}
            rx={TRACK_HEIGHT / 2}
            ry={TRACK_HEIGHT / 2}
            stroke="var(--primary)"
            strokeWidth={1}
            style={{ cursor: 'grab' }}
            width={windowW}
            x={startX}
            y={trackTop}
          />
          {/* Sobreposição translúcida da janela em cima do histograma */}
          <rect
            fill="var(--primary)"
            fillOpacity={0.06}
            height={HISTOGRAM_HEIGHT}
            pointerEvents="none"
            width={windowW}
            x={startX}
            y={histogramTop}
          />

          {/* Handle esquerdo */}
          <rect
            aria-label="Início da faixa"
            aria-valuemax={toIdx - MIN_SPAN}
            aria-valuemin={0}
            aria-valuenow={fromIdx}
            aria-valuetext={formatCompetencia(value.from)}
            fill="var(--background)"
            height={TRACK_HEIGHT + 8}
            onKeyDown={(e) => handleKey('start', e)}
            onPointerDown={(e) => startDrag('start', e)}
            rx={3}
            ry={3}
            stroke="var(--primary)"
            strokeWidth={2}
            style={{ cursor: 'ew-resize', outline: 'none' }}
            tabIndex={0}
            role="slider"
            width={HANDLE_WIDTH}
            x={startX - HANDLE_WIDTH / 2}
            y={trackTop - 4}
          />
          {/* Handle direito */}
          <rect
            aria-label="Fim da faixa"
            aria-valuemax={max}
            aria-valuemin={fromIdx + MIN_SPAN}
            aria-valuenow={toIdx}
            aria-valuetext={formatCompetencia(value.to)}
            fill="var(--background)"
            height={TRACK_HEIGHT + 8}
            onKeyDown={(e) => handleKey('end', e)}
            onPointerDown={(e) => startDrag('end', e)}
            rx={3}
            ry={3}
            stroke="var(--primary)"
            strokeWidth={2}
            style={{ cursor: 'ew-resize', outline: 'none' }}
            tabIndex={0}
            role="slider"
            width={HANDLE_WIDTH}
            x={endX - HANDLE_WIDTH / 2}
            y={trackTop - 4}
          />
        </svg>

        {/* Labels de início de ano (mesmo padrão do slider antigo). */}
        <div aria-hidden="true" className="relative mt-1 h-3">
          {months.map((c, i) => {
            if (!c.endsWith('-01')) return null;
            const yearPct = max === 0 ? 0 : (i / max) * 100;
            const align = yearPct < 4 ? 'start' : yearPct > 96 ? 'end' : 'center';
            const style: React.CSSProperties =
              align === 'start'
                ? { left: 0 }
                : align === 'end'
                  ? { right: 0 }
                  : { left: `${yearPct}%`, transform: 'translateX(-50%)' };
            return (
              <span
                key={c}
                className="text-muted-foreground absolute top-0 font-sans text-[10px] tabular-nums"
                style={style}
              >
                {c.slice(0, 4)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
