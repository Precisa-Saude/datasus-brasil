import { useCallback, useEffect, useState } from 'react';

import { BiomarkerSelect } from '@/components/BiomarkerSelect';
import { CompetenciaSelect } from '@/components/CompetenciaSelect';
import { MapView } from '@/components/MapView';
import { MunicipioMapView } from '@/components/MunicipioMapView';
import type { AggregateIndex, MunicipioAggregate, UfAggregate } from '@/lib/aggregates';

interface NationalBundle {
  geoUF: GeoJSON.FeatureCollection;
  index: AggregateIndex;
  ufData: UfAggregate[];
}

interface UfDrilldown {
  geoMunicipios: GeoJSON.FeatureCollection;
  municipioData: MunicipioAggregate[];
  ufSigla: string;
}

async function loadNational(): Promise<NationalBundle> {
  const [indexRes, ufRes, geoRes] = await Promise.all([
    fetch('/data/sia-pa-index.json'),
    fetch('/data/sia-pa-uf.json'),
    fetch('/geo/uf.geojson'),
  ]);
  if (!indexRes.ok || !ufRes.ok || !geoRes.ok) {
    throw new Error(
      'Falha ao carregar dados agregados ou geometrias. Gere os agregados rodando `pnpm -F @datasus-brasil/site aggregate --ufs AC --months 2024-01..2024-01`.',
    );
  }
  const [index, ufData, geoUF] = (await Promise.all([
    indexRes.json(),
    ufRes.json(),
    geoRes.json(),
  ])) as [AggregateIndex, UfAggregate[], GeoJSON.FeatureCollection];
  return { geoUF, index, ufData };
}

async function loadUfDrilldown(ufSigla: string): Promise<UfDrilldown> {
  const [dataRes, geoRes] = await Promise.all([
    fetch(`/data/sia-pa-${ufSigla}-municipios.json`),
    fetch(`/geo/municipios/${ufSigla}.geojson`),
  ]);
  if (!dataRes.ok || !geoRes.ok) {
    throw new Error(`Dados municipais para ${ufSigla} ainda não disponíveis.`);
  }
  const [municipioData, geoMunicipios] = (await Promise.all([dataRes.json(), geoRes.json()])) as [
    MunicipioAggregate[],
    GeoJSON.FeatureCollection,
  ];
  return { geoMunicipios, municipioData, ufSigla };
}

export default function Home() {
  const [bundle, setBundle] = useState<NationalBundle | null>(null);
  const [drilldown, setDrilldown] = useState<null | UfDrilldown>(null);
  const [error, setError] = useState<null | string>(null);
  const [loinc, setLoinc] = useState<null | string>(null);
  const [competencia, setCompetencia] = useState<null | string>(null);

  useEffect(() => {
    loadNational().then(
      (b) => {
        setBundle(b);
        setLoinc(b.index.biomarkers[0]?.loinc ?? null);
        setCompetencia(b.index.competencias[0] ?? null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const handleUfClick = useCallback((ufSigla: string) => {
    loadUfDrilldown(ufSigla).then(
      (d) => setDrilldown(d),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const handleBackToBrazil = useCallback(() => {
    setDrilldown(null);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="font-sans text-2xl font-bold tracking-tight">
          Biomarcadores do SUS por região
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Distribuição geográfica de exames laboratoriais faturados ao SUS (SIA-PA) cruzada com o
          catálogo LOINC. Clique em uma UF para detalhar por município.
        </p>
      </header>

      {error !== null ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-4 text-sm">
          <p className="font-medium">Não foi possível carregar os dados.</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : null}

      {bundle && loinc !== null && competencia !== null ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
          <aside className="space-y-4">
            <BiomarkerSelect
              biomarkers={bundle.index.biomarkers}
              onChange={setLoinc}
              value={loinc}
            />
            <CompetenciaSelect
              competencias={bundle.index.competencias}
              onChange={setCompetencia}
              value={competencia}
            />
            {drilldown ? (
              <button
                className="border-border bg-background hover:bg-muted w-full rounded-md border px-3 py-2 font-sans text-sm"
                onClick={handleBackToBrazil}
                type="button"
              >
                ← Voltar ao Brasil
              </button>
            ) : null}
            <div className="border-border bg-muted/30 text-muted-foreground rounded-md border p-3 text-xs">
              <p className="font-sans font-medium text-foreground">Fonte</p>
              <p className="mt-1">
                SIA-SUS / Produção Ambulatorial, competência {competencia}. Filtrado para SIGTAP
                grupo 02.02 (laboratório clínico) e cruzado com LOINC.
              </p>
            </div>
          </aside>
          <div className="h-[600px]">
            {drilldown ? (
              <MunicipioMapView
                competencia={competencia}
                data={drilldown.municipioData}
                geoMunicipios={drilldown.geoMunicipios}
                loinc={loinc}
              />
            ) : (
              <MapView
                competencia={competencia}
                data={bundle.ufData}
                geoUF={bundle.geoUF}
                loinc={loinc}
                onUfClick={handleUfClick}
              />
            )}
          </div>
        </div>
      ) : !error ? (
        <p className="text-muted-foreground text-sm">Carregando agregados…</p>
      ) : null}
    </div>
  );
}
