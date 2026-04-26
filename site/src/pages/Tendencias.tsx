import { Plus } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ComboboxSlots } from '@/components/TendenciasSlots';
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

/**
 * Lê o estado inicial dos search params da URL (compartilhamento).
 * Schema (estilo formulário HTML — chaves repetidas para múltiplos
 * valores, evita o `%2C` ilegível de listas separadas por vírgula):
 *   ?mode=exames|ufs                       (default: exames)
 *   ?uf=SP                                  (escopo, modo exames; ausente = Brasil)
 *   ?loincs=2160-0&loincs=2345-7&loincs=…  (até 3, modo exames)
 *   ?loinc=2160-0                           (exame único, modo ufs)
 *   ?ufs=SP&ufs=RJ&ufs=MG                  (até 3, modo ufs)
 *
 * Valores inválidos (fora do manifest ou do schema) são descartados.
 */
function parseUrlState(sp: URLSearchParams) {
  const mode: Mode = sp.get('mode') === 'ufs' ? 'ufs' : 'exames';
  return {
    loinc: sp.get('loinc'),
    loincs: sp.getAll('loincs').filter(Boolean).slice(0, MAX_SERIES),
    mode,
    uf: sp.get('uf'),
    ufs: sp.getAll('ufs').filter(Boolean).slice(0, MAX_SERIES),
  };
}

interface SeedState {
  loincs: string[];
  mode: Mode;
  singleLoinc: null | string;
  ufList: string[];
  ufSigla: string;
}

interface SlotHandlers {
  add: () => void;
  change: (idx: number, value: string) => void;
  remove: (idx: number) => void;
}

/**
 * Geradora de handlers `change/add/remove` para um array de slots
 * (até MAX_SERIES). Mantém os updates imutáveis e usa um callback de
 * candidato para escolher o próximo valor a ser adicionado.
 */
function makeSlotHandlers(
  setter: Dispatch<SetStateAction<string[]>>,
  pickNext: () => string | undefined,
): SlotHandlers {
  return {
    add: () => {
      const candidate = pickNext();
      if (!candidate) return;
      setter((prev) => (prev.length >= MAX_SERIES ? prev : [...prev, candidate]));
    },
    change: (idx, value) =>
      setter((prev) => {
        const next = [...prev];
        next[idx] = value;
        return next;
      }),
    remove: (idx) => setter((prev) => prev.filter((_, i) => i !== idx)),
  };
}

function computeSeedState(
  m: AggregateIndex,
  topLoincs: string[],
  topUfs: string[],
  url: ReturnType<typeof parseUrlState>,
): SeedState {
  const knownLoinc = (l: string) => m.biomarkers.some((b) => b.loinc === l);
  const knownUf = (u: string) => m.availableUFs.includes(u);

  const fromUrlLoincs = url.loincs.filter(knownLoinc);
  const fromTopLoincs = topLoincs.filter(knownLoinc);
  const loincs =
    fromUrlLoincs.length > 0
      ? fromUrlLoincs
      : fromTopLoincs.length > 0
        ? fromTopLoincs
        : [m.biomarkers[0]?.loinc].filter((x): x is string => Boolean(x));

  const singleLoinc = url.loinc && knownLoinc(url.loinc) ? url.loinc : (loincs[0] ?? null);

  const fromUrlUfs = url.ufs.filter(knownUf);
  const fromTopUfs = topUfs.filter(knownUf);
  const ufList =
    fromUrlUfs.length > 0
      ? fromUrlUfs
      : fromTopUfs.length > 0
        ? fromTopUfs
        : m.availableUFs.slice(0, MAX_SERIES);

  const ufSigla = url.uf && knownUf(url.uf) ? url.uf : NATIONAL;

  return { loincs, mode: url.mode, singleLoinc, ufList, ufSigla };
}

export default function Tendencias() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [manifest, setManifest] = useState<AggregateIndex | null>(null);
  const [mode, setMode] = useState<Mode>('exames');
  const [loincs, setLoincs] = useState<string[]>([]);
  const [singleLoinc, setSingleLoinc] = useState<null | string>(null);
  const [ufSigla, setUfSigla] = useState<string>(NATIONAL);
  const [ufList, setUfList] = useState<string[]>([]);
  const [data, setData] = useState<null | TrendPoint[]>(null);
  const [error, setError] = useState<null | string>(null);
  const [loading, setLoading] = useState(false);
  const [bootKey, setBootKey] = useState(0);

  const retry = (): void => {
    setError(null);
    setManifest(null);
    setData(null);
    setBootKey((k) => k + 1);
  };

  useEffect(() => {
    Promise.all([
      loadManifest(),
      fetchTopLoincsByVolume(MAX_SERIES),
      fetchTopUfsByVolume(MAX_SERIES),
    ]).then(
      ([m, topLoincs, topUfs]) => {
        const seed = computeSeedState(m, topLoincs, topUfs, parseUrlState(searchParams));
        setManifest(m);
        setMode(seed.mode);
        if (seed.loincs.length > 0) setLoincs(seed.loincs);
        setSingleLoinc(seed.singleLoinc);
        setUfSigla(seed.ufSigla);
        if (seed.ufList.length > 0) setUfList(seed.ufList);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    // bootKey nas deps permite ao botão "Tentar novamente" re-executar
    // o boot completo (manifest + top-N).
  }, [bootKey]);

  // Sincroniza o estado atual de volta na URL (replace, sem poluir history).
  useEffect(() => {
    if (!manifest) return;
    const next = new URLSearchParams();
    next.set('mode', mode);
    if (mode === 'exames') {
      if (ufSigla !== NATIONAL) next.set('uf', ufSigla);
      // Chaves repetidas em vez de lista separada por vírgula — o
      // serializador do URLSearchParams encodaria a vírgula como %2C.
      for (const l of loincs) next.append('loincs', l);
    } else {
      if (singleLoinc) next.set('loinc', singleLoinc);
      for (const u of ufList) next.append('ufs', u);
    }
    setSearchParams(next, { replace: true });
  }, [manifest, mode, ufSigla, loincs, singleLoinc, ufList, setSearchParams]);

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

  const loincHandlers = makeSlotHandlers(
    setLoincs,
    () => manifest?.biomarkers.find((b) => !loincs.includes(b.loinc))?.loinc,
  );
  const ufHandlers = makeSlotHandlers(setUfList, () =>
    manifest?.availableUFs.find((u) => !ufList.includes(u)),
  );

  let escopoLabel: string;
  if (mode === 'exames') {
    escopoLabel = ufSigla === NATIONAL ? 'Brasil' : ufSigla;
  } else if (singleLoinc) {
    escopoLabel = biomarkersByLoinc[singleLoinc] ?? singleLoinc;
  } else {
    escopoLabel = '—';
  }

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

      {/* Estado de boot — sem manifest ainda nada de filtro/chart faz sentido. */}
      {!manifest && error === null ? (
        <div className="border-border bg-card col-span-full mt-2 flex h-[420px] flex-col items-center justify-center gap-3 rounded-lg border p-6 shadow-sm">
          <div className="border-muted-foreground/30 border-t-primary size-8 animate-spin rounded-full border-2" />
          <p className="text-muted-foreground font-sans text-sm">Carregando agregados…</p>
        </div>
      ) : null}

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

      {/* Cabeçalho da seção de slots — só após boot. */}
      {manifest ? (
        <div className="col-span-full mt-2 flex items-center justify-between">
          <span className="text-muted-foreground font-sans text-xs font-medium uppercase tracking-wide">
            {slotsLabel} ({slotsCount}/{MAX_SERIES})
          </span>
          {slotsRemaining > 0 ? (
            <button
              className="text-primary hover:bg-primary/10 inline-flex items-center gap-1 rounded-md px-2 py-1 font-sans text-xs font-medium transition-colors"
              onClick={mode === 'exames' ? loincHandlers.add : ufHandlers.add}
              type="button"
            >
              <Plus className="size-3.5" /> {addLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {manifest ? (
        <div className="col-span-full grid grid-cols-1 gap-4 md:grid-cols-3">
          {mode === 'exames' ? (
            <ComboboxSlots
              ariaPrefix="Biomarcador"
              colors={SERIES_COLORS}
              items={biomarkerItems}
              onChange={loincHandlers.change}
              onRemove={loincHandlers.remove}
              removeLabel="Remover exame"
              searchPlaceholder="Buscar exame…"
              values={loincs}
            />
          ) : (
            <ComboboxSlots
              ariaPrefix="UF"
              colors={SERIES_COLORS}
              items={ufItems}
              onChange={ufHandlers.change}
              onRemove={ufHandlers.remove}
              removeLabel="Remover UF"
              searchPlaceholder="Buscar UF…"
              values={ufList}
            />
          )}
        </div>
      ) : null}

      {manifest ? (
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
            <div className="text-muted-foreground flex h-[360px] items-center justify-center gap-3 font-sans text-sm">
              <div className="border-muted-foreground/30 border-t-primary size-5 animate-spin rounded-full border-2" />
              Carregando série…
            </div>
          ) : (
            <TrendChart data={data} series={series} />
          )}
        </section>
      ) : null}

      {error !== null ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive col-span-full mt-2 flex flex-col gap-3 rounded-lg border p-4 font-sans text-sm">
          <div>
            <p className="font-medium">Não foi possível carregar a série.</p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
          <button
            className="border-destructive/40 hover:bg-destructive/15 inline-flex w-fit items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium transition-colors"
            onClick={retry}
            type="button"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}
    </div>
  );
}
