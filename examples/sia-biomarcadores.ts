#!/usr/bin/env tsx
/**
 * Exemplo: SIA-PA → apenas exames laboratoriais (SIGTAP 02.02) →
 * agregados por biomarcador LOINC.
 *
 * Fluxo:
 *   1. stream do PA UF × mês
 *   2. `isSigtapLaboratorio` restringe ao grupo 02.02 (laboratório clínico)
 *   3. `enrichWithLoinc` anexa o biomarcador quando o SIGTAP tem
 *      equivalência no catálogo LOINC da Precisa Saúde
 *   4. agregamos por `biomarker.code`, somando quantidades
 *
 * Uso:
 *   pnpm exec tsx examples/sia-biomarcadores.ts [UF] [YEAR] [MONTH]
 *
 * Default: AC 2024 1.
 */

import { enrichWithLoinc, isSigtapLaboratorio, sia } from '@precisa-saude/datasus';

const uf = process.argv[2] ?? 'AC';
const year = Number(process.argv[3] ?? '2024');
const month = Number(process.argv[4] ?? '1');

process.stderr.write(`Baixando SIA-PA ${uf}/${year}/${String(month).padStart(2, '0')}...\n`);

interface Agregado {
  biomarker: string;
  loinc: null | string;
  sigtap: string;
  totalExames: number;
}

const porBiomarcador = new Map<string, Agregado>();
let totalLab = 0;
let totalComLoinc = 0;

for await (const record of sia.streamProducaoAmbulatorial({ month, uf, year })) {
  if (!isSigtapLaboratorio(typeof record.PA_PROC_ID === 'string' ? record.PA_PROC_ID : null)) {
    continue;
  }
  totalLab++;
  const enriched = enrichWithLoinc(record);
  if (enriched.loinc === null) continue;
  totalComLoinc++;
  const qtd = typeof record.PA_QTDAPR === 'number' ? record.PA_QTDAPR : 1;
  const key = enriched.loinc.biomarker.code;
  const atual = porBiomarcador.get(key);
  if (atual) {
    atual.totalExames += qtd;
  } else {
    porBiomarcador.set(key, {
      biomarker: enriched.loinc.biomarker.display,
      loinc: enriched.loinc.loinc,
      sigtap: enriched.loinc.sigtap!,
      totalExames: qtd,
    });
  }
}

process.stderr.write(
  `Exames laboratoriais: ${totalLab} (com mapeamento LOINC: ${totalComLoinc}).\n`,
);

const ordenado = Array.from(porBiomarcador.values()).sort((a, b) => b.totalExames - a.totalExames);
process.stdout.write(`${JSON.stringify(ordenado, null, 2)}\n`);
