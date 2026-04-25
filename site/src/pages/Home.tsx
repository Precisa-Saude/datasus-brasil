import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SelectedMunicipio } from '@/components/BrasilMap';
import { BrasilMap } from '@/components/BrasilMap';
import { CompetenciaSlider, formatCompetencia } from '@/components/CompetenciaSlider';
import { MunicipioDetail } from '@/components/MunicipioDetail';
import type { OverviewRow } from '@/components/OverviewTable';
import { OverviewTable } from '@/components/OverviewTable';
import type { AggregateIndex, MunicipioAggregate, UfAggregate } from '@/lib/aggregates';
import { MANIFEST_URL } from '@/lib/data-source';
import { fetchMunicipioAggregates, fetchUfAggregates } from '@/lib/queries';

async function loadManifest(): Promise<AggregateIndex> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    throw new Error(
      `Falha ao carregar ${MANIFEST_URL} (${res.status}). Rode ` +
        '`pnpm -F @datasus-viz/site aggregate` e atualize o bucket S3/CloudFront.',
    );
  }
  return (await res.json()) as AggregateIndex;
}

export default function Home() {
  const [manifest, setManifest] = useState<AggregateIndex | null>(null);
  const [ufData, setUfData] = useState<UfAggregate[] | null>(null);
  const [municipioData, setMunicipioData] = useState<MunicipioAggregate[] | null>(null);
  const [selectedMun, setSelectedMun] = useState<null | SelectedMunicipio>(null);
  const [selectedUf, setSelectedUf] = useState<null | string>(null);
  const [competencia, setCompetencia] = useState<null | string>(null);
  const [error, setError] = useState<null | string>(null);
  const [refitUfSignal, setRefitUfSignal] = useState(0);

  // Offset = altura do header (h-16 = 4rem) + respiro de 1.5rem.
  const PANEL_TOP = 'calc(4rem + 1.5rem)';
  const panelStyle = {
    left: 'max((100vw - var(--grid-max-w)) / 2, 1rem)',
    top: PANEL_TOP,
    width: 'calc(var(--col-w) * 3 + 2rem)',
  } as const;
  const detailStyle = {
    bottom: '1.5rem',
    right: 'max((100vw - var(--grid-max-w)) / 2, 1rem)',
    top: PANEL_TOP,
    width: 'calc(var(--col-w) * 4 + 3rem)',
  } as const;

  const biomarkersByLoinc = useMemo<Record<string, string>>(
    () =>
      manifest ? Object.fromEntries(manifest.biomarkers.map((b) => [b.loinc, b.display])) : {},
    [manifest],
  );

  useEffect(() => {
    loadManifest().then(
      (m) => {
        setManifest(m);
        setCompetencia(m.competencias[m.competencias.length - 1] ?? null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  useEffect(() => {
    if (!competencia) return;
    fetchUfAggregates(competencia).then(
      (rows) => setUfData(rows),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [competencia]);

  const handleUfClick = useCallback(
    (ufSigla: string) => {
      if (!competencia) return;
      setSelectedUf(ufSigla);
      setMunicipioData(null);
      fetchMunicipioAggregates(ufSigla, competencia).then(
        (rows) => setMunicipioData(rows),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      );
    },
    [competencia],
  );

  useEffect(() => {
    if (!selectedUf || !competencia) return;
    fetchMunicipioAggregates(selectedUf, competencia).then(
      (rows) => setMunicipioData(rows),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [selectedUf, competencia]);

  const handleBackToBrazil = useCallback(() => {
    setSelectedUf(null);
    setMunicipioData(null);
    setSelectedMun(null);
  }, []);

  const handleMunicipioClick = useCallback((m: SelectedMunicipio) => {
    setSelectedMun(m);
  }, []);

  const handleCloseCity = useCallback(() => {
    setSelectedMun(null);
    setRefitUfSignal((n) => n + 1);
  }, []);

  // Agregados prontos pras tabelas (soma de todos os biomarcadores).
  const ufRows = useMemo<OverviewRow[]>(() => {
    if (!ufData || !competencia) return [];
    const byUf = new Map<string, { valor: number; volume: number }>();
    for (const r of ufData) {
      if (r.competencia !== competencia) continue;
      const prev = byUf.get(r.ufSigla) ?? { valor: 0, volume: 0 };
      prev.volume += r.volumeExames;
      prev.valor += r.valorAprovadoBRL;
      byUf.set(r.ufSigla, prev);
    }
    return [...byUf.entries()].map(([sigla, v]) => ({
      key: sigla,
      primary: sigla,
      valor: v.valor,
      volume: v.volume,
    }));
  }, [ufData, competencia]);

  const muniRows = useMemo<OverviewRow[]>(() => {
    if (!municipioData || !competencia) return [];
    const byMun = new Map<
      string,
      { municipioCode: string; municipioNome: string; valor: number; volume: number }
    >();
    for (const r of municipioData) {
      if (r.competencia !== competencia) continue;
      const prev = byMun.get(r.municipioCode) ?? {
        municipioCode: r.municipioCode,
        municipioNome: r.municipioNome,
        valor: 0,
        volume: 0,
      };
      prev.volume += r.volumeExames;
      prev.valor += r.valorAprovadoBRL;
      byMun.set(r.municipioCode, prev);
    }
    return [...byMun.values()].map((v) => ({
      key: v.municipioCode,
      primary: v.municipioNome,
      valor: v.valor,
      volume: v.volume,
    }));
  }, [municipioData, competencia]);

  const handleUfRowClick = useCallback(
    (row: OverviewRow) => {
      handleUfClick(row.key);
    },
    [handleUfClick],
  );

  const handleMuniRowClick = useCallback(
    (row: OverviewRow) => {
      if (!selectedUf) return;
      setSelectedMun({ codigo: row.key, nome: row.primary, ufSigla: selectedUf });
    },
    [selectedUf],
  );

  const tablePanel = ((): React.ReactNode => {
    if (!manifest || !competencia) return null;
    const subtitle = `SIA-SUS ${formatCompetencia(competencia)}`;
    // Nível 3: município selecionado → detalhe por exame.
    if (selectedUf && selectedMun && municipioData) {
      return (
        <MunicipioDetail
          biomarkersByLoinc={biomarkersByLoinc}
          competencia={competencia}
          data={municipioData}
          municipio={selectedMun}
          onClose={handleCloseCity}
        />
      );
    }
    // Nível 2: UF selecionada → lista de municípios.
    if (selectedUf) {
      return (
        <OverviewTable
          emptyMessage={
            municipioData === null
              ? 'Carregando municípios…'
              : 'Nenhum município com exames laboratoriais nesta competência.'
          }
          onClose={handleBackToBrazil}
          onRowClick={handleMuniRowClick}
          primaryLabel="Município"
          rows={muniRows}
          subtitle={subtitle}
          title={
            <>
              {selectedUf} <span className="text-muted-foreground font-normal">— municípios</span>
            </>
          }
        />
      );
    }
    // Nível 1: país → lista de UFs.
    return (
      <OverviewTable
        emptyMessage="Sem dados para a competência selecionada."
        onRowClick={handleUfRowClick}
        primaryLabel="UF"
        rows={ufRows}
        subtitle={subtitle}
        title="Brasil — visão nacional"
      />
    );
  })();

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="absolute inset-0">
        {manifest && ufData && competencia !== null ? (
          <BrasilMap
            availableUFs={manifest.availableUFs}
            competencia={competencia}
            focusMunCodigo={selectedMun?.codigo ?? null}
            municipioData={municipioData}
            onMunicipioClick={handleMunicipioClick}
            onUfClick={handleUfClick}
            onZoomOutReset={handleBackToBrazil}
            refitUfSignal={refitUfSignal}
            selectedUf={selectedUf}
            ufData={ufData}
          />
        ) : !error ? (
          <div className="bg-background flex h-full w-full items-center justify-center">
            <p className="text-muted-foreground font-margem text-sm">Carregando agregados…</p>
          </div>
        ) : null}
      </div>

      {manifest && competencia !== null ? (
        <aside
          className="border-border bg-card/95 pointer-events-auto absolute z-10 space-y-2 overflow-auto rounded-lg border p-4 shadow-lg backdrop-blur-md"
          style={panelStyle}
        >
          <h1 className="font-margem text-base font-semibold tracking-tight">
            Biomarcadores do SUS por região
          </h1>
          <p className="text-muted-foreground font-margem text-sm leading-snug">
            {selectedUf
              ? `Cada polígono é um município de ${selectedUf}, colorido pelo volume de exames aprovados.`
              : 'Cada polígono é uma UF, colorida pelo volume de exames aprovados. Clique para detalhar por município.'}
          </p>
          <p className="text-muted-foreground font-margem text-xs leading-snug">
            SIA-SUS {formatCompetencia(competencia)}. Filtrado para SIGTAP 02.02 (laboratório) e
            cruzado com LOINC. Dados: {manifest.availableUFs.length}/27 UFs ×{' '}
            {manifest.years.length > 0
              ? `${manifest.years[0]}–${manifest.years[manifest.years.length - 1]}`
              : '—'}
            .
          </p>
        </aside>
      ) : null}

      {manifest && competencia !== null ? (
        <div className="border-border bg-card/95 pointer-events-auto absolute bottom-10 left-1/2 z-10 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border p-4 shadow-lg backdrop-blur-md">
          <CompetenciaSlider
            competencias={manifest.competencias}
            onChange={setCompetencia}
            value={competencia}
          />
        </div>
      ) : null}

      {tablePanel ? (
        <div className="absolute z-10" style={detailStyle}>
          {tablePanel}
        </div>
      ) : null}

      {error !== null ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive absolute top-4 right-4 z-10 max-w-sm rounded-lg border p-4 font-margem text-sm shadow-lg backdrop-blur">
          <p className="font-medium">Não foi possível carregar os dados.</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
