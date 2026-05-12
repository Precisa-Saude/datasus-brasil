import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@precisa-saude/ui/primitives';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * Paginação compartilhada — port do componente do medbench-brasil
 * (`site/src/components/ui/pagination.tsx` lá), mesma API e mesma UX:
 * seletor de tamanho de página, navegação primeira/anterior/próxima/
 * última, e indicador "N / M".
 */

export interface PaginationProps {
  itemsLabel?: string;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  totalRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100];

export function Pagination({
  itemsLabel = 'linhas',
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  totalRows,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const canPrev = current > 1;
  const canNext = current < totalPages;

  return (
    <div className="border-border flex flex-col items-center justify-between gap-3 border-t px-2 py-3 font-sans text-sm sm:flex-row">
      <div className="hidden items-center gap-2 sm:flex">
        <span className="text-muted-foreground">Mostrar</span>
        <Select
          onValueChange={(v) => {
            if (v !== null) onPageSizeChange(Number(v));
          }}
          value={String(pageSize)}
        >
          <SelectTrigger className="h-8 w-auto min-w-[5rem] px-2 py-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">por página</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          {totalRows} {itemsLabel}
        </span>
        <div className="flex items-center gap-1">
          <IconButton disabled={!canPrev} label="Primeira página" onClick={() => onPageChange(1)}>
            <ChevronsLeft className="h-4 w-4" />
          </IconButton>
          <IconButton
            disabled={!canPrev}
            label="Anterior"
            onClick={() => onPageChange(current - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <span className="text-muted-foreground min-w-[4rem] text-center font-mono">
            {current} / {totalPages}
          </span>
          <IconButton disabled={!canNext} label="Próxima" onClick={() => onPageChange(current + 1)}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          <IconButton
            disabled={!canNext}
            label="Última página"
            onClick={() => onPageChange(totalPages)}
          >
            <ChevronsRight className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="border-border text-foreground hover:bg-accent rounded-full border p-1 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
