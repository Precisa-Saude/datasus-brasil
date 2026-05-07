import { useEffect, useMemo, useState } from 'react';

import type { CompetenciaRange } from './aggregates';
import type { BinTotals, DataCube } from './data-cube';
import { buildMunicipioCube, buildUfCube, lookupRange } from './data-cube';

const EMPTY_TOTALS: Map<string, BinTotals> = new Map();

export interface DataCubes {
  municipioCube: DataCube | null;
  municipioTotals: Map<string, BinTotals> | null;
  ufCube: DataCube | null;
  ufTotals: Map<string, BinTotals>;
}

/**
 * Constrói os cubos de prefix-sum (cf. Falcon, `lib/data-cube.ts`) e
 * expõe lookups instantâneos pra um intervalo arbitrário.
 *
 * - `ufCube` é construído uma vez quando as competências chegam.
 * - `municipioCube` é construído quando o usuário entra numa UF; nulo
 *   fora do drill-down.
 * - Os `*Totals` são derivados via `lookupRange` (subtração de
 *   prefix-sums) — sub-millisegundo, alimenta mapa+tabela em tempo
 *   real durante o drag do brush.
 */
export function useDataCubes(
  competencias: string[] | undefined,
  selectedUf: null | string,
  range: CompetenciaRange | null,
  onError: (message: string) => void,
): DataCubes {
  const [ufCube, setUfCube] = useState<DataCube | null>(null);
  const [municipioCube, setMunicipioCube] = useState<DataCube | null>(null);

  useEffect(() => {
    if (!competencias) return;
    let cancelled = false;
    buildUfCube(competencias).then(
      (c) => {
        if (!cancelled) setUfCube(c);
      },
      (e: unknown) => {
        if (!cancelled) onError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [competencias, onError]);

  useEffect(() => {
    if (!competencias || !selectedUf) {
      setMunicipioCube(null);
      return;
    }
    let cancelled = false;
    buildMunicipioCube(selectedUf, competencias).then(
      (c) => {
        if (!cancelled) setMunicipioCube(c);
      },
      (e: unknown) => {
        if (!cancelled) onError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [competencias, selectedUf, onError]);

  const ufTotals = useMemo<Map<string, BinTotals>>(() => {
    if (!ufCube || !range) return EMPTY_TOTALS;
    return lookupRange(ufCube, range).byBin;
  }, [ufCube, range]);

  const municipioTotals = useMemo<Map<string, BinTotals> | null>(() => {
    if (!municipioCube || !range) return null;
    return lookupRange(municipioCube, range).byBin;
  }, [municipioCube, range]);

  return { municipioCube, municipioTotals, ufCube, ufTotals };
}
