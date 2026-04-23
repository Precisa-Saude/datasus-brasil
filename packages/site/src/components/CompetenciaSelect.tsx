export interface CompetenciaSelectProps {
  competencias: string[];
  value: string;
  onChange: (competencia: string) => void;
}

export function CompetenciaSelect({ competencias, onChange, value }: CompetenciaSelectProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
        Competência
      </span>
      <select
        aria-label="Selecionar competência"
        className="border-border bg-background w-full rounded-md border px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        onChange={(e) => onChange(e.target.value)}
        value={value}
      >
        {competencias.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
