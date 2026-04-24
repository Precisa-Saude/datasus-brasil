export interface CompetenciaSliderProps {
  competencias: string[];
  value: string;
  onChange: (competencia: string) => void;
}

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

export function CompetenciaSlider({ competencias, onChange, value }: CompetenciaSliderProps) {
  const index = Math.max(0, competencias.indexOf(value));
  const max = Math.max(0, competencias.length - 1);
  const pct = max === 0 ? 0 : (index / max) * 100;

  // Rótulo flutuante acompanha o knob. Nas pontas alinha left/right
  // pra não estourar fora do container; no meio usa translateX(-50%).
  const labelStyle: React.CSSProperties =
    pct < 6
      ? { left: 0 }
      : pct > 94
        ? { right: 0 }
        : { left: `${pct}%`, transform: 'translateX(-50%)' };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground font-sans text-[11px] font-medium tracking-wide uppercase">
        Competência
      </span>
      <div className="relative pt-6">
        <span
          className="text-foreground pointer-events-none absolute top-0 font-sans text-sm font-semibold tabular-nums whitespace-nowrap"
          style={labelStyle}
        >
          {formatCompetencia(value)}
        </span>
        <input
          aria-label="Selecionar competência"
          aria-valuetext={value}
          className="competencia-slider h-5 w-full appearance-none bg-transparent"
          max={max}
          min={0}
          onChange={(e) => {
            const i = Number(e.target.value);
            const next = competencias[i];
            if (next) onChange(next);
          }}
          step={1}
          style={{ '--pct': `${pct}%` } as React.CSSProperties}
          type="range"
          value={index}
        />
        <div aria-hidden="true" className="relative mt-1 h-3">
          {competencias.map((c, i) => {
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
