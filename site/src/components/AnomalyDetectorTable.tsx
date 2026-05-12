import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import type { AnomalyHit, AnomalyKind, PopulationLookup } from '@/lib/anomaly';
import { formatCompetencia } from '@/lib/format';

import { AnomalyDumbbell, isDumbbellLogScale } from './AnomalyDumbbell';
import { Pagination } from './ui/pagination';

/**
 * Card de um detector — cabeçalho + tabela (Município | UF | Mês |
 * Exame | dumbbell SVG) + paginação. Extraído da página `Explore`
 * pra manter cada arquivo dentro dos limites de tamanho do ESLint
 * (max-lines / max-lines-per-function) e pra isolar o template do
 * grid em um só lugar.
 */

const ROW_HEIGHT = 36;
const GRID_TEMPLATE = 'minmax(140px, 1.4fr) auto auto minmax(140px, 1.6fr) minmax(320px, 2.4fr)';

const KIND_COLORS: Record<AnomalyKind, string> = {
  concentration: '#f59e0b',
  'per-capita': '#10b981',
  'price-ratio': '#ef4444',
  spike: '#7c3aed',
};

const BASELINE_LABELS: Record<AnomalyKind, string> = {
  concentration: 'limite de concentração',
  'per-capita': 'baseline (mín. por 1k hab.)',
  'price-ratio': 'mediana nacional',
  spike: 'baseline (mediana)',
};

export interface AnomalyDetectorTableProps {
  axisLabel: string;
  formatValue: (v: number) => string;
  hits: AnomalyHit[];
  kind: AnomalyKind;
  labelForLoinc: (loinc: string) => string;
  page: number;
  pageSize: number;
  /** Lookup IBGE pra alimentar a row "População" do tooltip. `null` =
   *  dataset ainda não carregou (ou falhou). */
  populationLookup: null | PopulationLookup;
  /** Hit atualmente expandido (renderizado em painel abaixo da tabela
   *  pelo parent). A célula da competência ganha estado `aria-pressed`
   *  pra indicar a seleção visualmente. */
  selectedHitKey?: null | string;
  title: string;
  onHitSelect?: (hit: AnomalyHit) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

/** Chave canônica que identifica um hit dentro do tab atual. */
export function hitKey(hit: AnomalyHit): string {
  return `${hit.municipioCode}::${hit.competencia}::${hit.loinc}`;
}

export function AnomalyDetectorTable({
  axisLabel,
  formatValue,
  hits,
  kind,
  labelForLoinc,
  onHitSelect,
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  populationLookup,
  selectedHitKey,
  title,
}: AnomalyDetectorTableProps) {
  const totalPages = Math.max(1, Math.ceil(hits.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageHits = hits.slice(startIdx, startIdx + pageSize);
  const isLog = isDumbbellLogScale(pageHits);
  const color = KIND_COLORS[kind];

  return (
    <div className="border-border bg-card rounded-lg border p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-sans text-sm font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground flex items-center gap-3 font-sans text-[11px]">
          <span className="inline-flex items-center gap-1">
            <span className="bg-muted-foreground inline-block size-2 rounded-full" />
            {BASELINE_LABELS[kind]}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} />
            observado
          </span>
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[760px]" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
          <HeaderCell>Município</HeaderCell>
          <HeaderCell>UF</HeaderCell>
          <HeaderCell>Mês</HeaderCell>
          <HeaderCell>Exame</HeaderCell>
          <HeaderCell className="flex items-baseline justify-between gap-2">
            <span>{axisLabel}</span>
            {isLog ? <span className="text-[10px] opacity-70">escala log</span> : null}
          </HeaderCell>

          {pageHits.map((hit, idx) => (
            <Fragment key={`${kind}-${hit.municipioCode}-${hit.competencia}-${hit.loinc}-${idx}`}>
              <Cell>
                <Link
                  className="text-foreground hover:text-primary truncate font-medium transition-colors"
                  title={hit.municipioNome}
                  to={`/uf/${hit.ufSigla}/mun/${hit.municipioCode}`}
                >
                  {hit.municipioNome}
                </Link>
              </Cell>
              <Cell>
                <span className="text-muted-foreground">{hit.ufSigla}</span>
              </Cell>
              <Cell>
                {onHitSelect ? (
                  <button
                    aria-label={`Detalhar por estabelecimento — ${hit.municipioNome}, ${formatCompetencia(hit.competencia)}`}
                    aria-pressed={selectedHitKey === hitKey(hit)}
                    className={`tabular-nums whitespace-nowrap underline-offset-2 transition-colors hover:underline ${
                      selectedHitKey === hitKey(hit)
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => onHitSelect(hit)}
                    type="button"
                  >
                    {formatCompetencia(hit.competencia)}
                  </button>
                ) : (
                  <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatCompetencia(hit.competencia)}
                  </span>
                )}
              </Cell>
              <Cell>
                <span className="text-muted-foreground truncate" title={labelForLoinc(hit.loinc)}>
                  {labelForLoinc(hit.loinc)}
                </span>
              </Cell>
            </Fragment>
          ))}

          {/* Chart column — spans data rows + tick row inside the SVG */}
          <div
            className="border-border/50 border-b"
            style={{
              gridColumn: '5 / 6',
              gridRow: `2 / span ${pageHits.length + 1}`,
            }}
          >
            <AnomalyDumbbell
              formatValue={formatValue}
              hits={pageHits}
              kind={kind}
              labelForLoinc={labelForLoinc}
              populationLookup={populationLookup}
              rowHeight={ROW_HEIGHT}
            />
          </div>

          {/* Footer cells (col 1-4) pra balancear a row de ticks dentro do SVG */}
          <Cell />
          <Cell />
          <Cell />
          <Cell />
        </div>
      </div>

      <Pagination
        itemsLabel="achados"
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        page={safePage}
        pageSize={pageSize}
        totalRows={hits.length}
      />
    </div>
  );
}

function HeaderCell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border-border text-muted-foreground flex items-center border-b px-3 py-2 font-sans text-[11px] font-medium uppercase tracking-wide ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

function Cell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border-border/50 flex items-center overflow-hidden border-b px-3 font-sans text-xs ${className ?? ''}`}
      style={{ height: ROW_HEIGHT }}
    >
      {children}
    </div>
  );
}
