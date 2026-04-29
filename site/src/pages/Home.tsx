import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

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

const GERADO_EM_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatGeradoEm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : GERADO_EM_FMT.format(d);
}

export default function Home() {
  // URL é a fonte da verdade do drill-down. `/` = Brasil,
  // `/uf/:ufSigla` = UF, `/uf/:ufSigla/mun/:codigo` = município.
  // Competência fica em ?competencia= para ser preservada entre níveis
  // sem inflar o histórico do browser.
  const params = useParams<{ codigo?: string; ufSigla?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ufSiglaParam = params.ufSigla?.toUpperCase() ?? null;
  const codigoParam = params.codigo ?? null;

  const [manifest, setManifest] = useState<AggregateIndex | null>(null);
  const [ufData, setUfData] = useState<UfAggregate[] | null>(null);
  const [municipioData, setMunicipioData] = useState<MunicipioAggregate[] | null>(null);
  const [error, setError] = useState<null | string>(null);
  const [refitUfSignal, setRefitUfSignal] = useState(0);

  const competenciaParam = searchParams.get('competencia');
  const competencia = useMemo<null | string>(() => {
    if (!manifest) return null;
    if (competenciaParam && manifest.competencias.includes(competenciaParam)) {
      return competenciaParam;
    }
    return manifest.competencias[manifest.competencias.length - 1] ?? null;
  }, [manifest, competenciaParam]);

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
      (m) => setManifest(m),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  // UF inválida na URL → volta pra Brasil (replace, sem poluir histórico).
  useEffect(() => {
    if (!manifest || !ufSiglaParam) return;
    if (!manifest.availableUFs.includes(ufSiglaParam)) {
      navigate({ pathname: '/', search: searchParams.toString() }, { replace: true });
    }
  }, [manifest, ufSiglaParam, navigate, searchParams]);

  const selectedUf = ufSiglaParam;

  useEffect(() => {
    if (!competencia) return;
    fetchUfAggregates(competencia).then(
      (rows) => setUfData(rows),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [competencia]);

  useEffect(() => {
    if (!selectedUf || !competencia) {
      setMunicipioData(null);
      return;
    }
    fetchMunicipioAggregates(selectedUf, competencia).then(
      (rows) => setMunicipioData(rows),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [selectedUf, competencia]);

  // selectedMun é derivado do path + municipioData (precisa do nome
  // pra exibir no painel). Enquanto os dados não chegam, usa o código
  // como nome de fallback.
  const selectedMun = useMemo<null | SelectedMunicipio>(() => {
    if (!selectedUf || !codigoParam) return null;
    const key6 = codigoParam.slice(0, 6);
    const match = municipioData?.find((r) => r.municipioCode.slice(0, 6) === key6);
    return {
      codigo: codigoParam,
      nome: match?.municipioNome ?? codigoParam,
      ufSigla: selectedUf,
    };
  }, [selectedUf, codigoParam, municipioData]);

  // Município inválido na URL (não existe na UF) → volta pra UF.
  useEffect(() => {
    if (!selectedUf || !codigoParam || !municipioData) return;
    const key6 = codigoParam.slice(0, 6);
    const exists = municipioData.some((r) => r.municipioCode.slice(0, 6) === key6);
    if (!exists) {
      navigate(
        { pathname: `/uf/${selectedUf}`, search: searchParams.toString() },
        { replace: true },
      );
    }
  }, [selectedUf, codigoParam, municipioData, navigate, searchParams]);

  const search = searchParams.toString();
  const searchSuffix = search ? `?${search}` : '';

  const handleUfClick = useCallback(
    (ufSigla: string) => {
      navigate(`/uf/${ufSigla}${searchSuffix}`);
    },
    [navigate, searchSuffix],
  );

  // Zoom-out via wheel/pinch dispara reset automático: usa replace pra
  // não encher o histórico com voltas espelhadas do drill-in.
  const handleBackToBrazil = useCallback(() => {
    navigate(`/${searchSuffix}`, { replace: true });
  }, [navigate, searchSuffix]);

  const handleMunicipioClick = useCallback(
    (m: SelectedMunicipio) => {
      navigate(`/uf/${m.ufSigla}/mun/${m.codigo}${searchSuffix}`);
    },
    [navigate, searchSuffix],
  );

  const handleCloseCity = useCallback(() => {
    if (!selectedUf) return;
    navigate(`/uf/${selectedUf}${searchSuffix}`);
    setRefitUfSignal((n) => n + 1);
  }, [navigate, searchSuffix, selectedUf]);

  const handleCompetenciaChange = useCallback(
    (v: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('competencia', v);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

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
      navigate(`/uf/${selectedUf}/mun/${row.key}${searchSuffix}`);
    },
    [navigate, searchSuffix, selectedUf],
  );

  const tablePanel = ((): React.ReactNode => {
    if (!manifest || !competencia) return null;
    const subtitle = `SIA-SUS ${formatCompetencia(competencia)}`;
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
          <p
            className="text-muted-foreground/80 font-margem text-[11px] leading-snug"
            title={`Anos cobertos: ${manifest.years.join(', ') || '—'} · ${manifest.competencias.length} competências`}
          >
            Atualizado em {formatGeradoEm(manifest.geradoEm)}
          </p>
        </aside>
      ) : null}

      {manifest && competencia !== null ? (
        <div className="border-border bg-card/95 pointer-events-auto absolute bottom-10 left-1/2 z-10 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border p-4 shadow-lg backdrop-blur-md">
          <CompetenciaSlider
            competencias={manifest.competencias}
            onChange={handleCompetenciaChange}
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
