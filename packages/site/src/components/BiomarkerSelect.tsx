import type { AggregateIndex } from '@/lib/aggregates';

export interface BiomarkerSelectProps {
  biomarkers: AggregateIndex['biomarkers'];
  value: string;
  onChange: (loinc: string) => void;
}

export function BiomarkerSelect({ biomarkers, onChange, value }: BiomarkerSelectProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
        Biomarcador
      </span>
      <select
        aria-label="Selecionar biomarcador"
        className="border-border bg-background w-full rounded-md border px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        onChange={(e) => onChange(e.target.value)}
        value={value}
      >
        {biomarkers.map((b) => (
          <option key={b.loinc} value={b.loinc}>
            {b.display} — {b.code}
          </option>
        ))}
      </select>
    </label>
  );
}
