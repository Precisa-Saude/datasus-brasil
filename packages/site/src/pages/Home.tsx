import { useCallback, useEffect, useMemo, useState } from 'react';

import { BiomarkerSelect } from '@/components/BiomarkerSelect';
import type { SelectedMunicipio } from '@/components/BrasilMap';
import { BrasilMap } from '@/components/BrasilMap';
import { CompetenciaSelect } from '@/components/CompetenciaSelect';
import { MunicipioDetail } from '@/components/MunicipioDetail';
import type { AggregateIndex, MunicipioAggregate, UfAggregate } from '@/lib/aggregates';
import { MANIFEST_URL } from '@/lib/data-source';
import { fetchMunicipioAggregates, fetchUfAggregates } from '@/lib/queries';

async function loadManifest(): Promise<AggregateIndex> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    throw new Error(
      `Falha ao carregar ${MANIFEST_URL} (${res.status}). Rode o pipeline ` +
        '`pnpm -F @datasus-brasil/site aggregate:parquet` → ' +
        '`build:parquet-index` → `upload:aws`.',
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
  const [loinc, setLoinc] = useState<null | string>(null);
  const [competencia, setCompetencia] = useState<null | string>(null);
  const [error, setError] = useState<null | string>(null);

  const panelStyle = {
    left: 'max((100vw - var(--grid-max-w)) / 2, 1rem)',
    width: 'calc(var(--col-w) * 3 + 2rem)',
  } as const;
  const detailStyle = {
    height: '80%',
    right: 'max((100vw - var(--grid-max-w)) / 2, 1rem)',
    top: '10%',
    width: 'calc(var(--col-w) * 4 + 3rem)',
  } as const;

  const biomarkersByLoinc = useMemo<Record<string, string>>(
    () =>
      manifest ? Object.fromEntries(manifest.biomarkers.map((b) => [b.loinc, b.display])) : {},
    [manifest],
  );

  // Bootstrap: manifesto + primeiro query de UF.
  useEffect(() => {
    loadManifest().then(
      async (m) => {
        setManifest(m);
        setLoinc(m.biomarkers[0]?.loinc ?? null);
        setCompetencia(m.competencias[m.competencias.length - 1] ?? null);
        try {
          const rows = await fetchUfAggregates(m.years);
          setUfData(rows);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const handleUfClick = useCallback(
    (ufSigla: string) => {
      if (!manifest) return;
      setSelectedUf(ufSigla);
      setMunicipioData(null);
      fetchMunicipioAggregates(ufSigla, manifest.years).then(
        (rows) => setMunicipioData(rows),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      );
    },
    [manifest],
  );

  const handleBackToBrazil = useCallback(() => {
    setSelectedUf(null);
    setMunicipioData(null);
    setSelectedMun(null);
  }, []);

  const handleMunicipioClick = useCallback((m: SelectedMunicipio) => {
    setSelectedMun(m);
  }, []);

  const handleCloseDetail = useCallback(() => setSelectedMun(null), []);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="absolute inset-0">
        {manifest && ufData && loinc !== null && competencia !== null ? (
          <BrasilMap
            availableUFs={manifest.availableUFs}
            biomarkerDisplay={manifest.biomarkers.find((b) => b.loinc === loinc)?.display ?? loinc}
            biomarkersByLoinc={biomarkersByLoinc}
            competencia={competencia}
            loinc={loinc}
            municipioData={municipioData}
            onMunicipioClick={handleMunicipioClick}
            onUfClick={handleUfClick}
            selectedUf={selectedUf}
            ufData={ufData}
          />
        ) : !error ? (
          <div className="bg-background flex h-full w-full items-center justify-center">
            <p className="text-muted-foreground font-margem text-sm">Carregando agregados…</p>
          </div>
        ) : null}
      </div>

      {manifest && loinc !== null && competencia !== null ? (
        <aside
          className="border-border bg-card/95 pointer-events-auto absolute top-1/2 z-10 max-h-[calc(100%-2rem)] -translate-y-1/2 space-y-3 overflow-auto rounded-lg border p-4 shadow-lg backdrop-blur-md"
          style={panelStyle}
        >
          <header className="space-y-1">
            <h1 className="font-margem text-base font-semibold tracking-tight">
              Biomarcadores do SUS por região
            </h1>
            <p className="text-muted-foreground font-margem text-xs leading-snug">
              {selectedUf
                ? `Cada polígono é um município de ${selectedUf}, colorido pelo volume de exames aprovados.`
                : 'Cada polígono é uma UF, colorida pelo volume de exames aprovados. Clique para detalhar por município.'}
            </p>
          </header>

          <BiomarkerSelect biomarkers={manifest.biomarkers} onChange={setLoinc} value={loinc} />
          <CompetenciaSelect
            competencias={manifest.competencias}
            onChange={setCompetencia}
            value={competencia}
          />
          {selectedUf ? (
            <button
              className="border-border bg-background hover:bg-muted w-full rounded-md border px-3 py-2 font-margem text-sm"
              onClick={handleBackToBrazil}
              type="button"
            >
              ← Voltar ao Brasil
            </button>
          ) : null}
          <p className="text-muted-foreground font-margem text-[11px] leading-snug">
            SIA-SUS {competencia}. Filtrado para SIGTAP 02.02 (laboratório) e cruzado com LOINC.
            Dados: {manifest.availableUFs.length}/27 UFs ×{' '}
            {manifest.years.length > 0
              ? `${manifest.years[0]}–${manifest.years[manifest.years.length - 1]}`
              : '—'}
            .
          </p>
        </aside>
      ) : null}

      {manifest && selectedUf && selectedMun && municipioData && competencia ? (
        <div className="absolute z-10" style={detailStyle}>
          <MunicipioDetail
            biomarkersByLoinc={biomarkersByLoinc}
            competencia={competencia}
            data={municipioData}
            municipio={selectedMun}
            onClose={handleCloseDetail}
            selectedLoinc={loinc ?? ''}
          />
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
