import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { formatBRL, formatInt } from '@/lib/tooltip';
import { cn } from '@/lib/utils';

export interface OverviewRow {
  key: string;
  primary: string;
  secondary?: string;
  valor: number;
  volume: number;
}

export interface OverviewTableProps {
  /** Mensagem exibida quando `rows` está vazio. */
  emptyMessage?: string;
  /** Rótulo da coluna-nome. */
  primaryLabel: string;
  rows: OverviewRow[];
  subtitle: React.ReactNode;
  title: React.ReactNode;
  /** Exibe o botão de fechar e dispara o callback. */
  onClose?: () => void;
  onRowClick?: (row: OverviewRow) => void;
}

type SortKey = 'primary' | 'valor' | 'volume';
type SortDir = 'asc' | 'desc';
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  primary: 'asc',
  valor: 'desc',
  volume: 'desc',
};

/**
 * Tabela genérica para as visões hierárquicas do mapa: país (lista
 * UFs), UF (lista municípios), município (lista exames). A linha é
 * clicável para drill-down e o header tem botão opcional de fechar
 * (volta pro nível anterior).
 */
export function OverviewTable(props: OverviewTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const rows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...props.rows].sort((a, b) => {
      if (sortKey === 'primary') return a.primary.localeCompare(b.primary) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [props.rows, sortKey, sortDir]);

  const totalVolume = rows.reduce((acc, r) => acc + r.volume, 0);
  const totalValor = rows.reduce((acc, r) => acc + r.valor, 0);

  const handleSort = (key: SortKey): void => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  };

  return (
    <aside className="border-border bg-card/98 pointer-events-auto flex h-full w-full flex-col overflow-hidden rounded-lg border shadow-lg backdrop-blur-md">
      <header className="border-border flex items-start justify-between gap-2 border-b p-4">
        <div>
          <h2 className="font-margem text-base font-semibold tracking-tight">{props.title}</h2>
          <p className="text-muted-foreground mt-1 font-margem text-xs">
            {props.subtitle} · {formatInt(totalVolume)} total · {formatBRL(totalValor)}
          </p>
        </div>
        {props.onClose ? (
          <button
            aria-label="Fechar"
            className="text-muted-foreground hover:bg-muted hover:text-foreground -m-1 rounded-md p-1"
            onClick={props.onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="text-muted-foreground p-4 font-margem text-sm">
            {props.emptyMessage ?? 'Sem dados para a competência selecionada.'}
          </div>
        ) : (
          <table className="w-full font-margem text-xs">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 text-[10px] font-medium tracking-wide uppercase">
              <tr>
                <SortHeader
                  active={sortKey === 'primary'}
                  align="left"
                  dir={sortDir}
                  label={props.primaryLabel}
                  onClick={() => handleSort('primary')}
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
                const clickable = Boolean(props.onRowClick);
                return (
                  <tr
                    key={r.key}
                    className={cn(
                      clickable ? 'hover:bg-muted/40 cursor-pointer' : 'hover:bg-muted/40',
                    )}
                    onClick={clickable ? () => props.onRowClick?.(r) : undefined}
                  >
                    <td className="border-border border-t px-3 py-2">
                      <div>{r.primary}</div>
                      {r.secondary ? (
                        <div className="text-muted-foreground text-[10px]">{r.secondary}</div>
                      ) : null}
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
