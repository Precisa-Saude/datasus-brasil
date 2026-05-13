import { Dialog, DialogContent, DialogTitle } from '@precisa-saude/ui/primitives';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { AnomalyDetectorTable, hitKey } from '@/components/AnomalyDetectorTable';
import { CnesBreakdown } from '@/components/CnesBreakdown';
import type { ComboboxItem } from '@/components/ui/combobox';
import { Combobox } from '@/components/ui/combobox';
import { SlidingToggle } from '@/components/ui/sliding-toggle';
import type { AggregateIndex } from '@/lib/aggregates';
import type { AnomalyHit, AnomalyKind } from '@/lib/anomaly';
import { MANIFEST_URL } from '@/lib/data-source';
import type { PopulationDataset } from '@/lib/population';
import { loadPopulation } from '@/lib/population';
import type { AnomaliesPayload } from '@/lib/queries';
import { fetchAnomalies } from '@/lib/queries';

/**
 * Explorador de atipicidades: lê os top-N hits pré-computados de cada
 * detector (`compute-anomalies.ts` ⇒ `public/anomalies/{kind}.json`)
 * e aplica filtros (UF, município, exame) client-side sobre listas
 * pequenas (~500 hits por detector). Sem DuckDB-WASM, sem 270 MB de
 * parquet em heap, sem cálculo bloqueando a main thread.
 *
 * Os parâmetros dos detectores ficam fixos no pipeline — qualquer
 * ajuste exige regenerar os artefatos via `pnpm build:anomalies`.
 * População IBGE só é necessária pro tooltip per-capita (taxa
 * relativa); o detector em si já rodou no pipeline.
 */
const ALL_LOINCS = '__ALL__';
const ALL_MUNICIPIOS = '__ALL__';
const ALL_UFS = '__ALL__';

const DETECTOR_TABS = [
  { label: 'Pico temporal', value: 'spike' },
  { label: 'Per capita', value: 'per-capita' },
  { label: 'Concentração', value: 'concentration' },
  { label: 'Preço/exame', value: 'price-ratio' },
] as const satisfies readonly { label: string; value: AnomalyKind }[];
const PAGE_GRID_STYLE = {
  gridTemplateColumns: 'repeat(12, 1fr)',
  margin: '0 auto',
  maxWidth: 'calc(var(--col-w) * 12 + 11rem)',
} as const;

const DETECTOR_LABELS: Record<AnomalyKind, string> = {
  concentration: 'Concentração',
  'per-capita': 'Per capita',
  'price-ratio': 'Preço/exame',
  spike: 'Pico temporal',
};

const DETECTOR_AXIS_LABELS: Record<AnomalyKind, string> = {
  concentration: 'Share do total LOINC × competência (município)',
  'per-capita': 'Exames por 1k habitantes',
  'price-ratio': 'BRL por exame',
  spike: 'Volume de exames no mês',
};

const DEFAULT_PAGE_SIZE = 20;

async function loadManifest(): Promise<AggregateIndex> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Falha ao carregar manifest (${res.status}).`);
  return (await res.json()) as AggregateIndex;
}

const NF_INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const NF_PCT = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
  style: 'percent',
});
const NF_BRL = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  maximumFractionDigits: 0,
  style: 'currency',
});

function formatValueForKind(kind: AnomalyKind): (v: number) => string {
  if (kind === 'concentration') return (v: number) => NF_PCT.format(v);
  if (kind === 'price-ratio') return (v: number) => NF_BRL.format(v);
  return (v: number) => NF_INT.format(v);
}

type PayloadCache = Partial<Record<AnomalyKind, AnomaliesPayload>>;
type ErrorCache = Partial<Record<AnomalyKind, string>>;

export default function Explore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [manifest, setManifest] = useState<AggregateIndex | null>(null);
  const [ufSigla, setUfSigla] = useState<string>(searchParams.get('uf') ?? ALL_UFS);
  const [loinc, setLoinc] = useState<string>(searchParams.get('loinc') ?? ALL_LOINCS);
  const [municipioCode, setMunicipioCode] = useState<string>(
    searchParams.get('mun') ?? ALL_MUNICIPIOS,
  );
  const [detector, setDetector] = useState<AnomalyKind>(() => {
    const raw = searchParams.get('det');
    if (raw === 'concentration' || raw === 'price-ratio' || raw === 'per-capita') return raw;
    return 'spike';
  });

  const [population, setPopulation] = useState<null | PopulationDataset>(null);
  const [payloads, setPayloads] = useState<PayloadCache>({});
  const [loadingKinds, setLoadingKinds] = useState<Set<AnomalyKind>>(new Set());
  const [errors, setErrors] = useState<ErrorCache>({});
  const [error, setError] = useState<null | string>(null);

  // Boot: carrega manifest + população IBGE (só pro tooltip per-capita).
  useEffect(() => {
    loadManifest().then(
      (m) => setManifest(m),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    loadPopulation().then(
      (p) => setPopulation(p),
      () => undefined,
    );
  }, []);

  // URL sync — omite parâmetros no estado default pra manter URL limpa.
  useEffect(() => {
    if (!manifest) return;
    const next = new URLSearchParams();
    if (ufSigla !== ALL_UFS) next.set('uf', ufSigla);
    if (loinc !== ALL_LOINCS) next.set('loinc', loinc);
    if (municipioCode !== ALL_MUNICIPIOS) next.set('mun', municipioCode);
    if (detector !== 'spike') next.set('det', detector);
    setSearchParams(next, { replace: true });
  }, [manifest, ufSigla, loinc, municipioCode, detector, setSearchParams]);

  // Fetch lazy do artefato do detector ativo. Cada tab carrega seu
  // JSON pré-computado uma vez e cacheia — trocar de tab vira instant
  // depois do primeiro toque.
  useEffect(() => {
    if (payloads[detector] !== undefined || loadingKinds.has(detector)) return;
    if (errors[detector] !== undefined) return;
    setLoadingKinds((prev) => {
      const next = new Set(prev);
      next.add(detector);
      return next;
    });
    fetchAnomalies(detector).then(
      (payload) => {
        setPayloads((prev) => ({ ...prev, [detector]: payload }));
        setLoadingKinds((prev) => {
          const next = new Set(prev);
          next.delete(detector);
          return next;
        });
      },
      (e: unknown) => {
        setErrors((prev) => ({
          ...prev,
          [detector]: e instanceof Error ? e.message : String(e),
        }));
        setLoadingKinds((prev) => {
          const next = new Set(prev);
          next.delete(detector);
          return next;
        });
      },
    );
  }, [detector, payloads, loadingKinds, errors]);

  const payload = payloads[detector];
  const loading = loadingKinds.has(detector);
  const detectorError = errors[detector];

  // Aplica filtros (UF / município / LOINC) sobre os hits pré-computados.
  // Concentração mantém o `observed` apontando pro `share` em vez do
  // volume bruto — o dumbbell e o axis label esperam isso.
  const hits = useMemo<AnomalyHit[]>(() => {
    if (!payload) return [];
    const base =
      detector === 'concentration'
        ? payload.hits.map((h) => ({
            ...h,
            baseline: 0.2,
            observed: h.details['share'] ?? 0,
          }))
        : payload.hits;
    return base.filter((h) => {
      if (ufSigla !== ALL_UFS && h.ufSigla !== ufSigla) return false;
      if (loinc !== ALL_LOINCS && h.loinc !== loinc) return false;
      if (municipioCode !== ALL_MUNICIPIOS && h.municipioCode !== municipioCode) return false;
      return true;
    });
  }, [payload, detector, ufSigla, loinc, municipioCode]);

  // Município dropdown: derivado dos hits do detector ativo. Só
  // aparecem municípios que de fato têm atipicidade — UX honesta e
  // o universo de opções é finito (≤500 entradas por tab).
  const municipios = useMemo<{ code: string; nome: string; ufSigla: string }[]>(() => {
    if (!payload) return [];
    const seen = new Map<string, { nome: string; ufSigla: string }>();
    for (const h of payload.hits) {
      if (ufSigla !== ALL_UFS && h.ufSigla !== ufSigla) continue;
      if (!seen.has(h.municipioCode))
        seen.set(h.municipioCode, { nome: h.municipioNome, ufSigla: h.ufSigla });
    }
    return Array.from(seen, ([code, info]) => ({ code, ...info })).sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR'),
    );
  }, [payload, ufSigla]);

  // Reseta município quando UF muda — o conjunto disponível pode ter
  // mudado.
  useEffect(() => {
    setMunicipioCode(ALL_MUNICIPIOS);
  }, [ufSigla]);

  // Reseta paginação quando filtros ou detector mudam.
  const [pageByKind, setPageByKind] = useState<Record<AnomalyKind, number>>({
    concentration: 1,
    'per-capita': 1,
    'price-ratio': 1,
    spike: 1,
  });
  const [pageSizeByKind, setPageSizeByKind] = useState<Record<AnomalyKind, number>>({
    concentration: DEFAULT_PAGE_SIZE,
    'per-capita': DEFAULT_PAGE_SIZE,
    'price-ratio': DEFAULT_PAGE_SIZE,
    spike: DEFAULT_PAGE_SIZE,
  });
  useEffect(() => {
    setPageByKind((prev) => ({ ...prev, [detector]: 1 }));
  }, [detector, ufSigla, municipioCode, loinc]);

  // Linha expandida pra detalhamento por CNES. Reseta quando contexto muda.
  const [selectedHit, setSelectedHit] = useState<AnomalyHit | null>(null);
  useEffect(() => {
    setSelectedHit(null);
  }, [detector, ufSigla, municipioCode, loinc]);

  const biomarkersByLoinc = useMemo<Record<string, string>>(
    () =>
      manifest ? Object.fromEntries(manifest.biomarkers.map((b) => [b.loinc, b.display])) : {},
    [manifest],
  );

  const ufItems = useMemo<ComboboxItem[]>(
    () =>
      manifest
        ? [
            { label: 'Todos os Estados', value: ALL_UFS },
            ...manifest.availableUFs.map((uf) => ({ label: uf, value: uf })),
          ]
        : [],
    [manifest],
  );

  const municipioItems = useMemo<ComboboxItem[]>(
    () => [
      { label: 'Todos os municípios', value: ALL_MUNICIPIOS },
      ...municipios.map((m) => ({
        // No modo "Todos os Estados" o label inclui a sigla pra
        // desambiguar homônimos entre UFs (Bom Jesus, Bonito, etc.).
        label: ufSigla === ALL_UFS ? `${m.nome} — ${m.ufSigla}` : m.nome,
        value: m.code,
      })),
    ],
    [municipios, ufSigla],
  );

  const loincItems = useMemo<ComboboxItem[]>(
    () =>
      manifest
        ? [
            { label: 'Todos os exames', value: ALL_LOINCS },
            ...manifest.biomarkers.map((b) => ({
              label: `${b.display} — ${b.loinc}`,
              value: b.loinc,
            })),
          ]
        : [],
    [manifest],
  );

  return (
    <div className="grid w-full gap-4 px-4 pt-24 pb-10 md:px-0" style={PAGE_GRID_STYLE}>
      <header className="col-span-full space-y-1">
        <h1 className="font-sans text-2xl font-semibold tracking-tight">Explorar atipicidades</h1>
        <p className="text-muted-foreground font-sans text-sm">
          Encontre municípios e períodos que destoam do padrão — picos temporais, concentração
          incomum ou valores fora da curva do exame.
        </p>
      </header>

      {!manifest && error === null ? (
        <div className="border-border bg-card col-span-full mt-2 flex h-[420px] flex-col items-center justify-center gap-3 rounded-lg border p-6 shadow-sm">
          <div className="border-muted-foreground/30 border-t-primary size-8 animate-spin rounded-full border-2" />
          <p className="text-muted-foreground font-sans text-sm">Carregando agregados…</p>
        </div>
      ) : null}

      {manifest ? (
        <>
          <label className="col-span-full flex flex-col gap-1 md:col-span-3">
            <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
              UF
            </span>
            <Combobox
              ariaLabel="Selecionar UF"
              items={ufItems}
              onChange={setUfSigla}
              searchPlaceholder="Buscar UF…"
              value={ufSigla}
            />
          </label>

          <label className="col-span-full flex flex-col gap-1 md:col-span-3">
            <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
              Município
            </span>
            <Combobox
              ariaLabel="Selecionar município"
              items={municipioItems}
              onChange={setMunicipioCode}
              searchPlaceholder="Buscar município…"
              value={municipioCode}
            />
          </label>

          <label className="col-span-full flex flex-col gap-1 md:col-span-6">
            <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
              Exame
            </span>
            <Combobox
              ariaLabel="Selecionar exame"
              items={loincItems}
              onChange={setLoinc}
              searchPlaceholder="Buscar exame…"
              value={loinc}
            />
          </label>

          <div className="col-span-full mt-2 flex justify-center">
            <SlidingToggle<AnomalyKind>
              items={DETECTOR_TABS}
              onChange={setDetector}
              value={detector}
            />
          </div>

          <section className="col-span-full mt-2">
            {loading ? (
              <div className="text-muted-foreground flex h-[360px] items-center justify-center gap-3 font-sans text-sm">
                <div className="border-muted-foreground/30 border-t-primary size-5 animate-spin rounded-full border-2" />
                Carregando atipicidades…
              </div>
            ) : null}

            {detectorError !== undefined ? (
              <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 font-sans text-sm">
                <p className="font-medium">Não foi possível carregar este detector.</p>
                <p className="mt-1 text-xs">{detectorError}</p>
              </div>
            ) : null}

            {!loading && payload && hits.length === 0 ? (
              <div className="border-border bg-card flex h-[200px] items-center justify-center rounded-lg border p-6 text-center">
                <p className="text-muted-foreground font-sans text-sm">
                  Nenhuma atipicidade encontrada com os filtros atuais. Tente outra UF, outro
                  município, outro exame ou outro detector.
                </p>
              </div>
            ) : null}

            {!loading && hits.length > 0 && payload ? (
              <>
                <AnomalyDetectorTable
                  axisLabel={DETECTOR_AXIS_LABELS[detector]}
                  formatValue={formatValueForKind(detector)}
                  hits={hits}
                  kind={detector}
                  labelForLoinc={(l) => biomarkersByLoinc[l] ?? l}
                  onHitSelect={(h) =>
                    setSelectedHit((prev) => (prev && hitKey(prev) === hitKey(h) ? null : h))
                  }
                  onPageChange={(p) => setPageByKind((prev) => ({ ...prev, [detector]: p }))}
                  onPageSizeChange={(s) => {
                    setPageSizeByKind((prev) => ({ ...prev, [detector]: s }));
                    setPageByKind((prev) => ({ ...prev, [detector]: 1 }));
                  }}
                  page={pageByKind[detector]}
                  pageSize={pageSizeByKind[detector]}
                  populationLookup={population?.lookup ?? null}
                  selectedHitKey={selectedHit ? hitKey(selectedHit) : null}
                  title={DETECTOR_LABELS[detector]}
                />
                {payload.totalHitsBeforeCap > payload.topN ? (
                  <p className="text-muted-foreground mt-2 font-sans text-[11px]">
                    Mostrando os {payload.topN.toLocaleString('pt-BR')} hits de maior score
                    (detector encontrou {payload.totalHitsBeforeCap.toLocaleString('pt-BR')} no
                    total).
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        </>
      ) : null}

      {error !== null ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive col-span-full mt-2 rounded-lg border p-4 font-sans text-sm">
          <p className="font-medium">Não foi possível carregar os dados.</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      ) : null}

      {/* Modal de detalhamento por CNES — disparado pela coluna CNES
          do `AnomalyDetectorTable`. Mantém estado controlado pelo
          `selectedHit`: setar abre, fechar limpa. */}
      <Dialog onOpenChange={(open) => !open && setSelectedHit(null)} open={selectedHit !== null}>
        <DialogContent
          className="max-w-3xl"
          // O `CnesBreakdown` já renderiza o título do contexto
          // (município, UF, mês, exame) e a tabela; o DialogTitle fica
          // visualmente oculto mas presente pro screen reader.
        >
          <DialogTitle className="sr-only">Detalhamento por estabelecimento (CNES)</DialogTitle>
          {selectedHit ? (
            <CnesBreakdown hit={selectedHit} labelForLoinc={(l) => biomarkersByLoinc[l] ?? l} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
