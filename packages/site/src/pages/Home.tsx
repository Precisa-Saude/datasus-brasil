import { useCallback, useEffect, useMemo, useState } from 'react';

import { BiomarkerSelect } from '@/components/BiomarkerSelect';
import type { SelectedMunicipio } from '@/components/BrasilMap';
import { BrasilMap } from '@/components/BrasilMap';
import { CompetenciaSelect } from '@/components/CompetenciaSelect';
import { MunicipioDetail } from '@/components/MunicipioDetail';
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
  const [selectedMun, setSelectedMun] = useState<null | SelectedMunicipio>(null);
  // Painel flutuante posicionado absolutamente em relação ao mapa,
  // centralizado verticalmente. Largura = 3 colunas do grid
  // compartilhado (`--col-w` do @precisa-saude/themes); `left` começa
  // na borda esquerda do grid (= gutter fora do max-w).
  const panelStyle = {
    left: 'max((100vw - var(--grid-max-w)) / 2, 1rem)',
    width: 'calc(var(--col-w) * 3 + 2rem)',
  } as const;
  // Painel de detalhe na col oposta (direita), 4 cols, altura fixa em
  // 80% do mapa e centralizado vertical — espelha o comportamento do
  // painel de filtros e garante que a tabela nunca excede o viewport.
  const detailStyle = {
    height: '80%',
    right: 'max((100vw - var(--grid-max-w)) / 2, 1rem)',
    top: '10%',
    width: 'calc(var(--col-w) * 4 + 3rem)',
  } as const;

  const biomarkersByLoinc = useMemo<Record<string, string>>(
    () =>
      bundle ? Object.fromEntries(bundle.index.biomarkers.map((b) => [b.loinc, b.display])) : {},
    [bundle],
  );

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
    setSelectedMun(null);
  }, []);

  const handleMunicipioClick = useCallback((m: SelectedMunicipio) => {
    setSelectedMun(m);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedMun(null);
  }, []);

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Camada do mapa ocupa 100% do espaço entre header e footer.
          Instância única do Mapbox é mantida entre UF e município; a
          transição troca só os layers + anima `fitBounds`. */}
      <div className="absolute inset-0">
        {bundle && loinc !== null && competencia !== null ? (
          <BrasilMap
            availableUFs={bundle.index.availableUFs ?? []}
            biomarkerDisplay={
              bundle.index.biomarkers.find((b) => b.loinc === loinc)?.display ?? loinc
            }
            biomarkersByLoinc={biomarkersByLoinc}
            competencia={competencia}
            drilldown={drilldown}
            geoUF={bundle.geoUF}
            loinc={loinc}
            onMunicipioClick={handleMunicipioClick}
            onUfClick={handleUfClick}
            ufData={bundle.ufData}
          />
        ) : !error ? (
          <div className="bg-background flex h-full w-full items-center justify-center">
            <p className="text-muted-foreground font-margem text-sm">Carregando agregados…</p>
          </div>
        ) : null}
      </div>

      {/* Painel flutuante: absolute no mapa, col 1 do grid compartilhado,
          centralizado verticalmente. */}
      {bundle && loinc !== null && competencia !== null ? (
        <aside
          className="border-border bg-card/95 pointer-events-auto absolute top-1/2 z-10 max-h-[calc(100%-2rem)] -translate-y-1/2 space-y-3 overflow-auto rounded-lg border p-4 shadow-lg backdrop-blur-md"
          style={panelStyle}
        >
          <header className="space-y-1">
            <h1 className="font-margem text-base font-semibold tracking-tight">
              Biomarcadores do SUS por região
            </h1>
            <p className="text-muted-foreground font-margem text-xs leading-snug">
              {drilldown
                ? `Cada polígono é um município de ${drilldown.ufSigla}, colorido pelo volume de exames aprovados.`
                : 'Cada polígono é uma UF, colorida pelo volume de exames aprovados. Clique para detalhar por município.'}
            </p>
          </header>

          <BiomarkerSelect biomarkers={bundle.index.biomarkers} onChange={setLoinc} value={loinc} />
          <CompetenciaSelect
            competencias={bundle.index.competencias}
            onChange={setCompetencia}
            value={competencia}
          />
          {drilldown ? (
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
          </p>
        </aside>
      ) : null}

      {/* Painel de detalhe do município (direita). Altura fixa em 80%
          do mapa, centralizado vertical — a lista rola dentro da
          <table>. */}
      {bundle && drilldown && selectedMun && competencia ? (
        <div className="absolute z-10" style={detailStyle}>
          <MunicipioDetail
            biomarkersByLoinc={biomarkersByLoinc}
            competencia={competencia}
            data={drilldown.municipioData}
            municipio={selectedMun}
            onClose={handleCloseDetail}
            selectedLoinc={loinc ?? ''}
          />
        </div>
      ) : null}

      {/* Erro flutuante (canto superior direito). */}
      {error !== null ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive absolute top-4 right-4 z-10 max-w-sm rounded-lg border p-4 font-margem text-sm shadow-lg backdrop-blur">
          <p className="font-medium">Não foi possível carregar os dados.</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
