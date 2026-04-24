import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { MunicipioAggregate } from '@/lib/aggregates';
import { formatBRL, formatInt } from '@/lib/tooltip';
import { cn } from '@/lib/utils';

import { formatCompetencia } from './CompetenciaSlider';

export interface MunicipioDetailProps {
  biomarkersByLoinc: Record<string, string>;
  competencia: string;
  data: MunicipioAggregate[];
  municipio: { codigo: string; nome: string; ufSigla: string };
  onClose: () => void;
}

interface Row {
  display: string;
  loinc: string;
  valor: number;
  volume: number;
}

type SortKey = 'display' | 'valor' | 'volume';
type SortDir = 'asc' | 'desc';

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  display: 'asc',
  valor: 'desc',
  volume: 'desc',
};

/**
 * Painel lateral com a lista completa de exames laboratoriais
 * faturados num município × competência. Ordenação clicável por
 * qualquer coluna; default = volume desc. Exames sem dados são
 * sempre omitidos.
 */
export function MunicipioDetail(props: MunicipioDetailProps) {
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const rows = useMemo<Row[]>(() => {
    const key6 = props.municipio.codigo.slice(0, 6);
    const base = props.data
      .filter((r) => r.competencia === props.competencia && r.municipioCode.slice(0, 6) === key6)
      .filter((r) => r.volumeExames > 0)
      .map((r) => ({
        display: props.biomarkersByLoinc[r.loinc] ?? r.loinc,
        loinc: r.loinc,
        valor: r.valorAprovadoBRL,
        volume: r.volumeExames,
      }));
    const dir = sortDir === 'asc' ? 1 : -1;
    return base.sort((a, b) => {
      if (sortKey === 'display') return a.display.localeCompare(b.display) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [
    props.data,
    props.competencia,
    props.municipio.codigo,
    props.biomarkersByLoinc,
    sortKey,
    sortDir,
  ]);

  const totalVolume = rows.reduce((acc, r) => acc + r.volume, 0);
  const totalValor = rows.reduce((acc, r) => acc + r.valor, 0);

  const handleSort = (key: SortKey): void => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  };

  return (
    <aside className="border-border bg-card/98 pointer-events-auto flex h-full w-full flex-col overflow-hidden rounded-lg border shadow-lg backdrop-blur-md">
      <header className="border-border flex items-start justify-between gap-2 border-b p-4">
        <div>
          <h2 className="font-margem text-base font-semibold tracking-tight">
            {props.municipio.nome}
            <span className="text-muted-foreground ml-1 font-normal">
              — {props.municipio.ufSigla}
            </span>
          </h2>
          <p className="text-muted-foreground mt-1 font-margem text-xs">
            Exames laboratoriais em {formatCompetencia(props.competencia)} ·{' '}
            {formatInt(totalVolume)} total · {formatBRL(totalValor)}
          </p>
        </div>
        <button
          aria-label="Fechar"
          className="text-muted-foreground hover:bg-muted hover:text-foreground -m-1 rounded-md p-1"
          onClick={props.onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="text-muted-foreground p-4 font-margem text-sm">
            Nenhum exame laboratorial registrado neste município para a competência selecionada.
          </div>
        ) : (
          <table className="w-full font-margem text-xs">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 text-[10px] font-medium uppercase tracking-wide">
              <tr>
                <SortHeader
                  active={sortKey === 'display'}
                  align="left"
                  dir={sortDir}
                  label="Exame"
                  onClick={() => handleSort('display')}
                />
                <SortHeader
                  active={sortKey === 'volume'}
                  align="right"
                  dir={sortDir}
                  label="Volume"
                  onClick={() => handleSort('volume')}
                />
                <SortHeader
                  active={sortKey === 'valor'}
                  align="right"
                  dir={sortDir}
                  label="Faturado"
                  onClick={() => handleSort('valor')}
                />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                return (
                  <tr key={r.loinc} className="hover:bg-muted/40">
                    <td className="border-border border-t px-3 py-2">
                      <div>{r.display}</div>
                      <div className="text-muted-foreground text-[10px]">LOINC {r.loinc}</div>
                    </td>
                    <td className="border-border border-t px-3 py-2 text-right font-mono tabular-nums">
                      {formatInt(r.volume)}
                    </td>
                    <td className="border-border text-muted-foreground border-t px-3 py-2 text-right font-mono tabular-nums">
                      {formatBRL(r.valor)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  );
}

function SortHeader({
  active,
  align,
  dir,
  label,
  onClick,
}: {
  active: boolean;
  align: 'left' | 'right';
  dir: SortDir;
  label: string;
  onClick: () => void;
}) {
  const Icon = dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th className={cn('px-3 py-2', align === 'left' ? 'text-left' : 'text-right')}>
      <button
        className={cn(
          'hover:text-foreground inline-flex items-center gap-1 transition-colors',
          active ? 'text-foreground' : '',
        )}
        onClick={onClick}
        type="button"
      >
        <span>{label}</span>
        <Icon
          aria-hidden="true"
          className={cn('h-3 w-3 transition-opacity', active ? 'opacity-100' : 'opacity-30')}
        />
      </button>
    </th>
  );
}
