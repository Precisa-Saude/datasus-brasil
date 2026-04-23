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

export function MapboxTokenMissing() {
  return (
    <div className="border-border bg-muted/30 text-muted-foreground flex h-full min-h-[400px] items-center justify-center rounded-lg border p-8 text-center">
      <div className="max-w-md space-y-3">
        <h3 className="font-sans text-base font-semibold">Token do Mapbox não configurado</h3>
        <p className="text-sm">
          Defina <code className="font-mono text-xs">VITE_MAPBOX_TOKEN</code> num arquivo{' '}
          <code className="font-mono text-xs">.env.local</code> dentro de{' '}
          <code className="font-mono text-xs">packages/site/</code> para habilitar o mapa.
        </p>
        <p className="text-xs">
          Tokens gratuitos disponíveis em{' '}
          <a
            className="underline"
            href="https://account.mapbox.com/"
            rel="noreferrer"
            target="_blank"
          >
            account.mapbox.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
