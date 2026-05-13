import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';

import type { AnomalyHit, AnomalyKind, PopulationLookup } from '@/lib/anomaly';
import { formatCompetencia } from '@/lib/format';

import { AnomalyDumbbell, isDumbbellLogScale } from './AnomalyDumbbell';
import { Pagination } from './ui/pagination';

/**
 * Card de um detector — cabeçalho + tabela (Município | UF | Mês |
 * Exame | CNES | dumbbell SVG) + paginação. A linha inteira (colunas
 * 1-4) é um link pro detalhe do município com janela de 1 mês exato;
 * a coluna CNES tem um botão separado que dispara o modal de
 * detalhamento por estabelecimento via `onHitSelect`.
 */

const ROW_HEIGHT = 36;
// 6 colunas: município (link) | UF | mês | exame | CNES (botão) | dumbbell.
// As 4 primeiras são preenchidas pelo Link da linha; CNES e o
// dumbbell ficam fora do alvo de clique pra navegação.
const GRID_TEMPLATE =
  'minmax(140px, 1.4fr) auto auto minmax(140px, 1.6fr) auto minmax(320px, 2.4fr)';

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
  /** Hit cujo modal de CNES está aberto. Usado pra `aria-pressed` no
   *  botão da coluna CNES. */
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

/**
 * Monta o `?from=…&to=…` da janela de 1 mês exata correspondente ao
 * hit. `from===to` é interpretado pelo `useCompetenciaRange` como
 * janela de um único mês (BETWEEN inclusivo nos dois extremos), o
 * que faz o painel de detalhe mostrar exatamente o volume daquela
 * linha do explorador — sem somar o mês seguinte por engano.
 */
function hitDrilldownSearch(hit: AnomalyHit): string {
  return `?from=${hit.competencia}&to=${hit.competencia}`;
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

  // Hover compartilhado entre as 4 células do mesmo hit (link).
  // CSS grid não casca o hover entre cells siblings sem JS — então
  // rastreamos o índice da linha sob o mouse e cada cell consulta.
  const [hoveredIdx, setHoveredIdx] = useState<null | number>(null);

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
        <div className="grid min-w-[820px]" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
          <HeaderCell>Município</HeaderCell>
          <HeaderCell>UF</HeaderCell>
          <HeaderCell>Mês</HeaderCell>
          <HeaderCell>Exame</HeaderCell>
          <HeaderCell>CNES</HeaderCell>
          <HeaderCell className="flex items-baseline justify-between gap-2">
            <span>{axisLabel}</span>
            {isLog ? <span className="text-[10px] opacity-70">escala log</span> : null}
          </HeaderCell>

          {pageHits.map((hit, idx) => {
            const isHovered = hoveredIdx === idx;
            const rowBg = isHovered ? 'bg-muted/60' : '';
            const onEnter = (): void => setHoveredIdx(idx);
            const onLeave = (): void => setHoveredIdx((prev) => (prev === idx ? null : prev));
            const url = `/uf/${hit.ufSigla}/mun/${hit.municipioCode}${hitDrilldownSearch(hit)}`;
            return (
              <Fragment key={`${kind}-${hit.municipioCode}-${hit.competencia}-${hit.loinc}-${idx}`}>
                <RowLinkCell
                  bg={rowBg}
                  onEnter={onEnter}
                  onLeave={onLeave}
                  title={hit.municipioNome}
                  to={url}
                >
                  <span className="text-foreground truncate font-medium">{hit.municipioNome}</span>
                </RowLinkCell>
                <RowLinkCell bg={rowBg} onEnter={onEnter} onLeave={onLeave} to={url}>
                  <span className="text-muted-foreground">{hit.ufSigla}</span>
                </RowLinkCell>
                <RowLinkCell bg={rowBg} onEnter={onEnter} onLeave={onLeave} to={url}>
                  <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatCompetencia(hit.competencia)}
                  </span>
                </RowLinkCell>
                <RowLinkCell
                  bg={rowBg}
                  onEnter={onEnter}
                  onLeave={onLeave}
                  title={labelForLoinc(hit.loinc)}
                  to={url}
                >
                  <span className="text-muted-foreground truncate">{labelForLoinc(hit.loinc)}</span>
                </RowLinkCell>
                <Cell className={rowBg} onMouseEnter={onEnter} onMouseLeave={onLeave}>
                  {onHitSelect ? (
                    <button
                      aria-label={`Ver detalhamento por estabelecimento — ${hit.municipioNome}, ${formatCompetencia(hit.competencia)}`}
                      aria-pressed={selectedHitKey === hitKey(hit)}
                      className={`text-primary hover:text-primary/80 rounded font-sans text-xs underline-offset-2 transition-colors hover:underline ${
                        selectedHitKey === hitKey(hit) ? 'font-medium underline' : ''
                      }`}
                      onClick={() => onHitSelect(hit)}
                      type="button"
                    >
                      Ver CNES
                    </button>
                  ) : null}
                </Cell>
              </Fragment>
            );
          })}

          {/* Chart column — spans data rows + tick row inside the SVG */}
          <div
            className="border-border/50 border-b"
            style={{
              gridColumn: '6 / 7',
              gridRow: `2 / span ${pageHits.length + 1}`,
            }}
          >
            <AnomalyDumbbell
              formatValue={formatValue}
              hits={pageHits}
              hoveredRowIdx={hoveredIdx}
              kind={kind}
              labelForLoinc={labelForLoinc}
              onRowHover={setHoveredIdx}
              populationLookup={populationLookup}
              rowHeight={ROW_HEIGHT}
            />
          </div>

          {/* Footer cells (col 1-5) pra balancear a row de ticks dentro do SVG */}
          <Cell />
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

function Cell({
  children,
  className,
  onMouseEnter,
  onMouseLeave,
}: {
  children?: React.ReactNode;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      className={`border-border/50 flex items-center overflow-hidden border-b px-3 font-sans text-xs transition-colors ${className ?? ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ height: ROW_HEIGHT }}
    >
      {children}
    </div>
  );
}

/**
 * Célula que é integralmente um link de navegação. Mantém a mesma
 * altura/alinhamento do `Cell` mas o alvo de clique cobre a área
 * inteira — clicar em qualquer parte da linha (col 1-4) navega pro
 * município. O botão da coluna CNES fica fora do link e tem
 * comportamento próprio.
 */
function RowLinkCell({
  bg,
  children,
  onEnter,
  onLeave,
  title,
  to,
}: {
  bg: string;
  children: React.ReactNode;
  onEnter: () => void;
  onLeave: () => void;
  title?: string;
  to: string;
}) {
  return (
    <Link
      className={`border-border/50 hover:text-foreground flex items-center overflow-hidden border-b px-3 font-sans text-xs transition-colors ${bg}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ height: ROW_HEIGHT }}
      title={title}
      to={to}
    >
      {children}
    </Link>
  );
}
