import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { AnomalyDetectorTable, hitKey } from '@/components/AnomalyDetectorTable';
import { CnesBreakdown } from '@/components/CnesBreakdown';
import type { ComboboxItem } from '@/components/ui/combobox';
import { Combobox } from '@/components/ui/combobox';
import { SlidingToggle } from '@/components/ui/sliding-toggle';
import type { AggregateIndex } from '@/lib/aggregates';
import type { AnomalyHit, AnomalyKind } from '@/lib/anomaly';
import {
  detectConcentration,
  detectPerCapitaOutliers,
  detectPriceRatioOutliers,
  detectTemporalSpikes,
} from '@/lib/anomaly';
import { MANIFEST_URL } from '@/lib/data-source';
import type { PopulationDataset } from '@/lib/population';
import { loadPopulation } from '@/lib/population';
import type { MunicipioAggregateRow } from '@/lib/queries';
import { fetchAnomalyDataset, fetchAnomalyDatasetMulti } from '@/lib/queries';

/**
 * Página exploratória de "datapoints fora do padrão" nos agregados
 * SIA-PA. Roda três heurísticas no client sobre o parquet da UF
 * selecionada e devolve uma lista ranqueada de tuplas
 * `(município, competência, LOINC)` por score do detector.
 *
 * O detector per-capita está documentado em `lib/anomaly.ts` mas não
 * é ativado aqui — depende de dataset de população IBGE que ainda
 * não foi ingerido. Quando o dataset existir, basta plugar o
 * `PopulationLookup` no `useMemo` abaixo.
 */
const ALL_LOINCS = '__ALL__';
const ALL_MUNICIPIOS = '__ALL__';
const ALL_UFS = '__ALL__';

type DetectorTabKey = 'concentration' | 'per-capita' | 'price-ratio' | 'spike';

const DETECTOR_TABS = [
  { label: 'Pico temporal', value: 'spike' },
  { label: 'Per capita', value: 'per-capita' },
  { label: 'Concentração', value: 'concentration' },
  { label: 'Preço/exame', value: 'price-ratio' },
] as const satisfies readonly { label: string; value: DetectorTabKey }[];
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

export default function Explore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [manifest, setManifest] = useState<AggregateIndex | null>(null);
  const [ufSigla, setUfSigla] = useState<string>(searchParams.get('uf') ?? ALL_UFS);
  const [loinc, setLoinc] = useState<string>(searchParams.get('loinc') ?? ALL_LOINCS);
  const [municipioCode, setMunicipioCode] = useState<string>(
    searchParams.get('mun') ?? ALL_MUNICIPIOS,
  );
  const [detector, setDetector] = useState<DetectorTabKey>(() => {
    const raw = searchParams.get('det');
    if (raw === 'concentration' || raw === 'price-ratio' || raw === 'per-capita') return raw;
    return 'spike';
  });
  const [population, setPopulation] = useState<null | PopulationDataset>(null);
  const [rows, setRows] = useState<MunicipioAggregateRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | string>(null);

  useEffect(() => {
    loadManifest().then(
      (m) => {
        setManifest(m);
        // Default = ALL_UFS; mantém só se o usuário tiver fixado outra
        // UF via search param.
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    // População é opcional pros outros detectores — falha silenciosa
    // significa que a tab "Per capita" e o campo no tooltip mostram
    // estado "indisponível", mas não bloqueiam o resto da página.
    loadPopulation().then(
      (p) => setPopulation(p),
      () => undefined,
    );
    // Boot apenas no mount; mudanças subsequentes vêm dos selects.
  }, []);

  // Sincroniza estado de volta na URL — permite compartilhar oddity.
  // Omitimos `uf` quando o modo é "Todos os Estados" (default), pra
  // manter a URL limpa no caso comum.
  useEffect(() => {
    if (!manifest) return;
    const next = new URLSearchParams();
    if (ufSigla !== ALL_UFS) next.set('uf', ufSigla);
    if (loinc !== ALL_LOINCS) next.set('loinc', loinc);
    if (municipioCode !== ALL_MUNICIPIOS) next.set('mun', municipioCode);
    if (detector !== 'spike') next.set('det', detector);
    setSearchParams(next, { replace: true });
  }, [manifest, ufSigla, loinc, municipioCode, detector, setSearchParams]);

  // Fetch dataset quando UF ou LOINC mudam. Município é filtro
  // client-side sobre os mesmos `rows` (já chegam por município),
  // então não dispara nova GET S3.
  // Para UF = "Todos os Estados", roda fetch em paralelo pra todas as
  // UFs do manifesto e concatena — custa mais bytes, mas o detector
  // de anomalias precisa ver a base nacional.
  useEffect(() => {
    if (!manifest) return;
    setLoading(true);
    setError(null);
    setRows(null);
    const safeLoinc = loinc === ALL_LOINCS ? undefined : loinc;
    const promise =
      ufSigla === ALL_UFS
        ? fetchAnomalyDatasetMulti({ loinc: safeLoinc, ufSiglas: manifest.availableUFs })
        : fetchAnomalyDataset({ loinc: safeLoinc, ufSigla });
    promise.then(
      (data) => {
        setRows(data);
        setLoading(false);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
  }, [manifest, ufSigla, loinc]);

  // Reseta município quando a UF muda — a lista de municípios depende
  // da UF, então o valor anterior pode não existir mais.
  useEffect(() => {
    setMunicipioCode(ALL_MUNICIPIOS);
  }, [ufSigla]);

  // Lista distinta de municípios derivada dos rows carregados.
  // No modo "Todos os Estados", carrega UF junto pra desambiguar
  // municípios com nome igual em UFs diferentes (Bom Jesus, etc.).
  // Ordena alfabeticamente pela nomenclatura IBGE.
  const municipios = useMemo<{ code: string; nome: string; ufSigla: string }[]>(() => {
    if (!rows) return [];
    const seen = new Map<string, { nome: string; ufSigla: string }>();
    for (const r of rows) {
      if (!seen.has(r.municipioCode))
        seen.set(r.municipioCode, { nome: r.municipioNome, ufSigla: r.ufSigla });
    }
    return Array.from(seen, ([code, info]) => ({ code, ...info })).sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR'),
    );
  }, [rows]);

  // Rows filtrados pelo município (quando selecionado) — alimentam
  // todos os detectores. Filtro local mantém a UI responsiva sem
  // refetch do S3.
  const filteredRows = useMemo<MunicipioAggregateRow[] | null>(() => {
    if (!rows) return null;
    if (municipioCode === ALL_MUNICIPIOS) return rows;
    return rows.filter((r) => r.municipioCode === municipioCode);
  }, [rows, municipioCode]);

  // Hits do detector selecionado. Concentração precisa do `share`
  // (do `details`) projetado como `observed` pro dumbbell.
  // Concentração roda sempre sobre o dataset COMPLETO da UF (não filtrado
  // por município) — senão o "total" do par (LOINC, competência)
  // perde sentido (passaria a ser sempre 100% para o município único).
  const hits = useMemo<AnomalyHit[]>(() => {
    if (!filteredRows) return [];
    if (detector === 'spike') return detectTemporalSpikes(filteredRows);
    if (detector === 'price-ratio') return detectPriceRatioOutliers(filteredRows);
    if (detector === 'per-capita') {
      if (!population) return [];
      return detectPerCapitaOutliers(filteredRows, population.lookup);
    }
    const base = rows ?? filteredRows;
    return detectConcentration(base)
      .filter((h) => (municipioCode === ALL_MUNICIPIOS ? true : h.municipioCode === municipioCode))
      .map((h) => ({ ...h, baseline: 0.2, observed: h.details['share'] ?? 0 }));
  }, [filteredRows, rows, detector, municipioCode, population]);

  // Paginação — page (1-indexado) + pageSize por detector.
  // Reseta page=1 quando o dataset bruto muda ou município muda.
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
    setPageByKind({ concentration: 1, 'per-capita': 1, 'price-ratio': 1, spike: 1 });
  }, [rows, municipioCode]);

  // Linha expandida para detalhamento por CNES. Resetado sempre que o
  // dataset, o município ou o detector mudam — não faz sentido manter
  // seleção entre contextos diferentes.
  const [selectedHit, setSelectedHit] = useState<AnomalyHit | null>(null);
  useEffect(() => {
    setSelectedHit(null);
  }, [rows, municipioCode, detector]);

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
            <SlidingToggle<DetectorTabKey>
              items={DETECTOR_TABS}
              onChange={setDetector}
              value={detector}
            />
          </div>

          <section className="col-span-full mt-2">
            {loading ? (
              <div className="text-muted-foreground flex h-[360px] items-center justify-center gap-3 font-sans text-sm">
                <div className="border-muted-foreground/30 border-t-primary size-5 animate-spin rounded-full border-2" />
                Calculando atipicidades…
              </div>
            ) : null}

            {!loading && rows && hits.length === 0 ? (
              <div className="border-border bg-card flex h-[200px] items-center justify-center rounded-lg border p-6 text-center">
                <p className="text-muted-foreground font-sans text-sm">
                  Nenhuma atipicidade encontrada com os filtros atuais. Tente outra UF, outro
                  município, outro exame ou outro detector.
                </p>
              </div>
            ) : null}

            {!loading && hits.length > 0 ? (
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
                {selectedHit ? (
                  <CnesBreakdown
                    hit={selectedHit}
                    labelForLoinc={(l) => biomarkersByLoinc[l] ?? l}
                    onClose={() => setSelectedHit(null)}
                  />
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
    </div>
  );
}
