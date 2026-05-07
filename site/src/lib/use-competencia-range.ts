import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { CompetenciaRange } from './aggregates';

const DEFAULT_WINDOW_MONTHS = 12;

/**
 * Resolve a faixa de competências a partir dos search params da URL.
 *
 * Regras:
 * - `?from=YYYY-MM&to=YYYY-MM` válido → usa direto.
 * - `?competencia=YYYY-MM` (legado) → vira faixa de 2 meses terminando
 *   no mês pedido (ou começando nele, se for o primeiro disponível).
 *   Reescreve a URL pra `?from&to` em seguida (replace, sem inflar o
 *   histórico).
 * - Falta de params ou params inválidos → últimos 12 meses.
 *
 * Retorna `null` enquanto o manifest não carregou ou se há menos de 2
 * competências disponíveis (faixa mínima).
 */
export interface CompetenciaRangeApi {
  range: CompetenciaRange | null;
  setRange: (next: CompetenciaRange) => void;
}

export function useCompetenciaRange(competencias: string[] | undefined): CompetenciaRangeApi {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const competenciaParam = searchParams.get('competencia');

  const range = useMemo<CompetenciaRange | null>(() => {
    if (!competencias || competencias.length < 2) return null;
    const last = competencias[competencias.length - 1] as string;
    const fallbackFromIdx = Math.max(0, competencias.length - DEFAULT_WINDOW_MONTHS);
    const defaultRange: CompetenciaRange = {
      from: competencias[fallbackFromIdx] as string,
      to: last,
    };

    if (!fromParam && !toParam && competenciaParam) {
      const i = competencias.indexOf(competenciaParam);
      if (i >= 0) {
        if (i === 0) return { from: competencias[0] as string, to: competencias[1] as string };
        return { from: competencias[i - 1] as string, to: competencias[i] as string };
      }
    }

    const fromOk = fromParam && competencias.includes(fromParam) ? fromParam : null;
    const toOk = toParam && competencias.includes(toParam) ? toParam : null;
    if (fromOk && toOk && fromOk < toOk) return { from: fromOk, to: toOk };
    return defaultRange;
  }, [competencias, fromParam, toParam, competenciaParam]);

  useEffect(() => {
    if (!range) return;
    const needsRewrite =
      searchParams.get('from') !== range.from ||
      searchParams.get('to') !== range.to ||
      searchParams.has('competencia');
    if (!needsRewrite) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('competencia');
        next.set('from', range.from);
        next.set('to', range.to);
        return next;
      },
      { replace: true },
    );
  }, [range, searchParams, setSearchParams]);

  const setRange = useCallback(
    (next: CompetenciaRange) => {
      setSearchParams(
        (prev) => {
          const np = new URLSearchParams(prev);
          np.delete('competencia');
          np.set('from', next.from);
          np.set('to', next.to);
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { range, setRange };
}
