import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { TrendSeries } from '@/components/TrendChart';
import { TrendChart } from '@/components/TrendChart';
import type { ComboboxItem } from '@/components/ui/combobox';
import { Combobox } from '@/components/ui/combobox';
import { SlidingToggle } from '@/components/ui/sliding-toggle';
import type { AggregateIndex } from '@/lib/aggregates';
import { MANIFEST_URL } from '@/lib/data-source';
import type { TrendPoint } from '@/lib/queries';
import {
  fetchTopLoincsByVolume,
  fetchTopUfsByVolume,
  fetchTrend,
  fetchTrendByUf,
} from '@/lib/queries';

async function loadManifest(): Promise<AggregateIndex> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    throw new Error(`Falha ao carregar manifest (${res.status}).`);
  }
  return (await res.json()) as AggregateIndex;
}

const NATIONAL = '__BR__';
const MAX_SERIES = 3;

type Mode = 'exames' | 'ufs';

// Paleta legível em fundo claro/escuro, contraste mútuo bom.
// Hex puros (não tokens) porque recharts precisa do valor resolvido para legenda/tooltip.
const SERIES_COLORS = ['#7c3aed', '#f59e0b', '#10b981'];

const PAGE_GRID_STYLE = {
  gridTemplateColumns: 'repeat(12, 1fr)',
  margin: '0 auto',
  maxWidth: 'calc(var(--col-w) * 12 + 11rem)',
} as const;

interface SlotRemoveButtonProps {
  ariaLabel: string;
  onClick: () => void;
}

function SlotRemoveButton({ ariaLabel, onClick }: SlotRemoveButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1.5 transition-colors"
      onClick={onClick}
      type="button"
    >
      <X className="size-4" />
    </button>
  );
}

function SlotBullet({ idx }: { idx: number }) {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full"
      style={{ background: SERIES_COLORS[idx] ?? '#6b7280' }}
    />
  );
}

interface ComboboxSlotsProps {
  ariaPrefix: string;
  items: ComboboxItem[];
  removeLabel: string;
  searchPlaceholder: string;
  values: string[];
  onChange: (idx: number, value: string) => void;
  onRemove: (idx: number) => void;
}

function ComboboxSlots({
  ariaPrefix,
  items,
  onChange,
  onRemove,
  removeLabel,
  searchPlaceholder,
  values,
}: ComboboxSlotsProps) {
  return (
    <>
      {values.map((v, idx) => (
        <div className="flex items-center gap-2" key={`${ariaPrefix}-${idx}-${v}`}>
          <SlotBullet idx={idx} />
          <div className="min-w-0 flex-1">
            <Combobox
              ariaLabel={`${ariaPrefix} ${idx + 1}`}
              items={items}
              onChange={(nv) => onChange(idx, nv)}
              searchPlaceholder={searchPlaceholder}
              value={v}
            />
          </div>
          {values.length > 1 ? (
            <SlotRemoveButton
              ariaLabel={`${removeLabel} ${idx + 1}`}
              onClick={() => onRemove(idx)}
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

export default function Tendencias() {
  const [manifest, setManifest] = useState<AggregateIndex | null>(null);
  const [mode, setMode] = useState<Mode>('exames');
  const [loincs, setLoincs] = useState<string[]>([]);
  const [singleLoinc, setSingleLoinc] = useState<null | string>(null);
  const [ufSigla, setUfSigla] = useState<string>(NATIONAL);
  const [ufList, setUfList] = useState<string[]>([]);
  const [data, setData] = useState<null | TrendPoint[]>(null);
  const [error, setError] = useState<null | string>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      loadManifest(),
      fetchTopLoincsByVolume(MAX_SERIES),
      fetchTopUfsByVolume(MAX_SERIES),
    ]).then(
      ([m, topLoincs, topUfs]) => {
        setManifest(m);
        // Defaults baseados em volume real, não ordem alfabética. Fallback
        // alfabético/primeiros disponíveis se a query top-N falhar ou
        // voltar vazia.
        const validLoincs = topLoincs.filter((l) => m.biomarkers.some((b) => b.loinc === l));
        const seedLoincs =
          validLoincs.length > 0
            ? validLoincs
            : [m.biomarkers[0]?.loinc].filter((x): x is string => Boolean(x));
        if (seedLoincs.length > 0) {
          setLoincs(seedLoincs);
          setSingleLoinc(seedLoincs[0] ?? null);
        }
        const validUfs = topUfs.filter((u) => m.availableUFs.includes(u));
        const seedUfs = validUfs.length > 0 ? validUfs : m.availableUFs.slice(0, MAX_SERIES);
        if (seedUfs.length > 0) setUfList(seedUfs);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  // Carrega dados conforme o modo. Cada modo dispara uma única query.
  useEffect(() => {
    if (mode === 'exames') {
      if (loincs.length === 0) {
        setData([]);
        return;
      }
      setLoading(true);
      setData(null);
      fetchTrend(loincs, ufSigla === NATIONAL ? null : ufSigla).then(
        (rows) => {
          setData(rows);
          setLoading(false);
        },
        (e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        },
      );
      return;
    }
    // mode === 'ufs'
    if (!singleLoinc || ufList.length === 0) {
      setData([]);
      return;
    }
    setLoading(true);
    setData(null);
    fetchTrendByUf(singleLoinc, ufList).then(
      (rows) => {
        setData(rows);
        setLoading(false);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
  }, [mode, loincs, ufSigla, singleLoinc, ufList]);

  const biomarkersByLoinc = useMemo<Record<string, string>>(
    () =>
      manifest ? Object.fromEntries(manifest.biomarkers.map((b) => [b.loinc, b.display])) : {},
    [manifest],
  );

  // Items reaproveitáveis para o Combobox.
  const biomarkerItems = useMemo<ComboboxItem[]>(
    () =>
      manifest
        ? manifest.biomarkers.map((b) => ({
            label: `${b.display} — ${b.loinc}`,
            value: b.loinc,
          }))
        : [],
    [manifest],
  );

  const ufItems = useMemo<ComboboxItem[]>(
    () => (manifest ? manifest.availableUFs.map((uf) => ({ label: uf, value: uf })) : []),
    [manifest],
  );

  const escopoItems = useMemo<ComboboxItem[]>(
    () => [{ label: 'Brasil (todas as UFs)', value: NATIONAL }, ...ufItems],
    [ufItems],
  );

  const series = useMemo<TrendSeries[]>(() => {
    if (mode === 'exames') {
      return loincs.map((loinc, idx) => ({
        color: SERIES_COLORS[idx] ?? '#6b7280',
        id: loinc,
        label: biomarkersByLoinc[loinc] ?? loinc,
      }));
    }
    return ufList.map((uf, idx) => ({
      color: SERIES_COLORS[idx] ?? '#6b7280',
      id: uf,
      label: uf,
    }));
  }, [mode, loincs, ufList, biomarkersByLoinc]);

  const handleLoincSlotChange = (index: number, value: string): void => {
    setLoincs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleAddLoincSlot = (): void => {
    if (!manifest || loincs.length >= MAX_SERIES) return;
    const used = new Set(loincs);
    const candidate = manifest.biomarkers.find((b) => !used.has(b.loinc));
    if (!candidate) return;
    setLoincs((prev) => [...prev, candidate.loinc]);
  };

  const handleRemoveLoincSlot = (index: number): void => {
    setLoincs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUfSlotChange = (index: number, value: string): void => {
    setUfList((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleAddUfSlot = (): void => {
    if (!manifest || ufList.length >= MAX_SERIES) return;
    const used = new Set(ufList);
    const candidate = manifest.availableUFs.find((u) => !used.has(u));
    if (!candidate) return;
    setUfList((prev) => [...prev, candidate]);
  };

  const handleRemoveUfSlot = (index: number): void => {
    setUfList((prev) => prev.filter((_, i) => i !== index));
  };

  const escopoLabel =
    mode === 'exames'
      ? ufSigla === NATIONAL
        ? 'Brasil'
        : ufSigla
      : (() => {
          if (!singleLoinc) return '—';
          return biomarkersByLoinc[singleLoinc] ?? singleLoinc;
        })();

  const slotsCount = mode === 'exames' ? loincs.length : ufList.length;
  const slotsRemaining = MAX_SERIES - slotsCount;
  const slotsLabel = mode === 'exames' ? 'Exames comparados' : 'UFs comparadas';
  const addLabel = mode === 'exames' ? 'Adicionar exame' : 'Adicionar UF';

  const headline =
    mode === 'exames'
      ? `Compare até ${MAX_SERIES} exames lado a lado dentro do mesmo escopo geográfico.`
      : `Compare até ${MAX_SERIES} UFs para o mesmo exame ao longo da série histórica.`;

  return (
    <div className="grid w-full gap-4 px-4 pt-24 pb-10 md:px-0" style={PAGE_GRID_STYLE}>
      <header className="col-span-full space-y-1">
        <h1 className="font-sans text-2xl font-semibold tracking-tight">Tendência temporal</h1>
        <p className="text-muted-foreground font-sans text-sm">{headline}</p>
      </header>

      <SlidingToggle<Mode>
        className="col-span-full mx-auto w-fit"
        items={[
          { label: 'Comparar exames', value: 'exames' },
          { label: 'Comparar UFs', value: 'ufs' },
        ]}
        onChange={setMode}
        value={mode}
      />

      {/* Escopo geográfico (apenas modo exames) — combobox com busca. */}
      {mode === 'exames' && manifest ? (
        <label className="col-span-full flex flex-col gap-1 md:col-span-4">
          <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
            Escopo geográfico
          </span>
          <Combobox
            ariaLabel="Selecionar escopo geográfico"
            items={escopoItems}
            onChange={setUfSigla}
            searchPlaceholder="Buscar UF…"
            value={ufSigla}
          />
        </label>
      ) : null}

      {/* Modo UFs: o exame único fica acima da linha de slots de UF. */}
      {mode === 'ufs' && manifest && singleLoinc !== null ? (
        <label className="col-span-full flex flex-col gap-1 md:col-span-4">
          <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
            Exame
          </span>
          <Combobox
            ariaLabel="Selecionar exame"
            items={biomarkerItems}
            onChange={setSingleLoinc}
            searchPlaceholder="Buscar exame…"
            value={singleLoinc}
          />
        </label>
      ) : null}

      {/* Cabeçalho da seção de slots. */}
      <div className="col-span-full mt-2 flex items-center justify-between">
        <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
          {slotsLabel} ({slotsCount}/{MAX_SERIES})
        </span>
        {manifest && slotsRemaining > 0 ? (
          <button
            className="text-primary hover:bg-primary/10 inline-flex items-center gap-1 rounded-md px-2 py-1 font-sans text-xs font-medium transition-colors"
            onClick={mode === 'exames' ? handleAddLoincSlot : handleAddUfSlot}
            type="button"
          >
            <Plus className="size-3.5" /> {addLabel}
          </button>
        ) : null}
      </div>

      {manifest ? (
        <div className="col-span-full grid grid-cols-1 gap-4 md:grid-cols-3">
          {mode === 'exames' ? (
            <ComboboxSlots
              ariaPrefix="Biomarcador"
              items={biomarkerItems}
              onChange={handleLoincSlotChange}
              onRemove={handleRemoveLoincSlot}
              removeLabel="Remover exame"
              searchPlaceholder="Buscar exame…"
              values={loincs}
            />
          ) : (
            <ComboboxSlots
              ariaPrefix="UF"
              items={ufItems}
              onChange={handleUfSlotChange}
              onRemove={handleRemoveUfSlot}
              removeLabel="Remover UF"
              searchPlaceholder="Buscar UF…"
              values={ufList}
            />
          )}
        </div>
      ) : null}

      <section className="border-border bg-card col-span-full mt-2 rounded-lg border p-6 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <p className="text-muted-foreground font-sans text-xs uppercase tracking-wide">
            {escopoLabel}
          </p>
          <p className="text-muted-foreground font-sans text-xs">
            Volume mensal de exames · valor R$ no tooltip
          </p>
        </div>
        {loading || !data ? (
          <div className="text-muted-foreground flex h-[360px] items-center justify-center font-sans text-sm">
            Carregando série…
          </div>
        ) : (
          <TrendChart data={data} series={series} />
        )}
      </section>

      {error !== null ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive col-span-full mt-2 rounded-lg border p-4 font-sans text-sm">
          <p className="font-medium">Não foi possível carregar a série.</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
