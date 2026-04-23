/**
 * Tipos do JSON pré-agregado que o CLI emite para `public/data/`.
 *
 * O site é 100% estático: nenhum runtime do Node, nenhuma chamada ao
 * FTP DATASUS. O pipeline de agregação (script em
 * `scripts/aggregate-sia.ts` no repo) baixa SIA-PA, filtra laboratório
 * (`isSigtapLaboratorio`), enriquece com LOINC (`enrichWithLoinc`) e
 * grava dois arquivos por ano:
 *
 *   public/data/sia-pa-{YYYY}-uf.json          → um registro por UF × biomarcador × mês
 *   public/data/sia-pa-{YYYY}-{UF}-municipios.json → lazy-loaded no drill-down
 */

/** Uma célula do agregado: UF × biomarcador × competência. */
export interface UfAggregate {
  /** Competência no formato ISO `"YYYY-MM"`. */
  competencia: string;
  /** Código LOINC canônico (ex: `"4548-4"`). */
  loinc: string;
  /** Código IBGE da UF (2 dígitos — ex: `"12"` para AC). */
  ufCode: string;
  /** Sigla UF (ex: `"AC"`). */
  ufSigla: string;
  /** Valor aprovado total (R$). */
  valorAprovadoBRL: number;
  /** Total de exames aprovados no período. */
  volumeExames: number;
}

/** Uma célula do agregado: município × biomarcador × competência. */
export interface MunicipioAggregate {
  competencia: string;
  loinc: string;
  /** Código IBGE do município (7 dígitos). */
  municipioCode: string;
  municipioNome: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

/** Metadados da agregação (biomarcadores presentes, competências, etc.). */
export interface AggregateIndex {
  biomarkers: Array<{
    /** Código curto do biomarcador (ex: `"HbA1c"`). */
    code: string;
    /** Nome legível (ex: `"Hemoglobina glicada"`). */
    display: string;
    loinc: string;
  }>;
  competencias: string[];
  /** Data em que o pipeline rodou (ISO). */
  geradoEm: string;
  /** Ano coberto pelos dados. */
  year: number;
}
