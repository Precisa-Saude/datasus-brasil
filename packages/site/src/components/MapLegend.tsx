export function MapLegend({ drilldown }: { drilldown: boolean }) {
  const stops = ['#f3f0ff', '#c7b8ff', '#7856d2', '#463c6d', '#2a2241'];
  return (
    <div
      aria-hidden="true"
      className="border-border bg-card/95 pointer-events-none absolute right-4 bottom-10 z-10 rounded-md border px-3 py-2 font-margem text-[11px] shadow-md backdrop-blur-sm"
    >
      <div className="text-muted-foreground mb-1">
        Volume de exames — {drilldown ? 'por município' : 'por UF'}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-[10px]">menor</span>
        <div className="flex h-2 w-32 overflow-hidden rounded-sm">
          {stops.map((c) => (
            <span key={c} className="h-full flex-1" style={{ background: c }} />
          ))}
        </div>
        <span className="text-muted-foreground text-[10px]">maior</span>
      </div>
    </div>
  );
}
