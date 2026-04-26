import { Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { wordStartFilter } from '@/lib/search';
import { cn } from '@/lib/utils';

export interface ComboboxItem {
  /** Texto exibido na lista e no botão. */
  label: string;
  /** Identificador único (passado em `onChange` e comparado com `value`). */
  value: string;
}

export interface ComboboxProps {
  ariaLabel?: string;
  emptyMessage?: string;
  items: ComboboxItem[];
  placeholder?: string;
  searchPlaceholder?: string;
  triggerClassName?: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Combobox genérico (Popover + cmdk Command) com busca filtrando do
 * início de cada palavra (acentos ignorados). Reaproveita as
 * primitivas shadcn locais. Use para qualquer lista grande onde
 * digitar é mais rápido que rolar — biomarcadores, UFs, etc.
 */
export function Combobox({
  ariaLabel,
  emptyMessage = 'Nenhum item encontrado.',
  items,
  onChange,
  placeholder = 'Selecionar…',
  searchPlaceholder = 'Buscar…',
  triggerClassName,
  value,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => items.find((it) => it.value === value), [items, value]);
  // Sem opções: não abre o popover e mostra "Sem opções" no trigger.
  // A lista fica desabilitada via `disabled` para que o foco/click não
  // tente expandir um menu vazio.
  const isEmpty = items.length === 0;

  return (
    <Popover onOpenChange={isEmpty ? undefined : setOpen} open={isEmpty ? false : open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            'border-border bg-background hover:bg-background w-full justify-between border font-sans font-normal text-foreground',
            triggerClassName,
          )}
          disabled={isEmpty}
          role="combobox"
          variant="outline"
        >
          <span className="truncate">
            {isEmpty ? 'Sem opções' : selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0 font-sans"
      >
        <Command filter={wordStartFilter(0)}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {items.map((it) => (
                <CommandItem
                  key={it.value}
                  onSelect={() => {
                    onChange(it.value);
                    setOpen(false);
                  }}
                  value={it.label}
                >
                  <span className="truncate">{it.label}</span>
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      it.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
