/**
 * Tabela QTINST01..QTINST37 — quantidades de instalações físicas.
 *
 * Cada coluna conta salas/ambientes de um tipo específico.
 * Fonte: dicionário CNES DATASUS (tabela `TP_INST`).
 */

export const INSTALACOES_LABELS: Record<string, string> = {
  QTINST01: 'Consultórios médicos',
  QTINST02: 'Consultórios odontológicos',
  QTINST03: 'Consultórios de outros profissionais (enfermagem, psicologia, etc.)',
  QTINST04: 'Consultórios combinados',
  QTINST05: 'Salas de reabilitação',
  QTINST06: 'Salas de repouso/observação (adulto)',
  QTINST07: 'Salas de repouso/observação (pediátrica)',
  QTINST08: 'Salas de hidratação',
  QTINST09: 'Leitos para exames de eletrofisiologia',
  QTINST10: 'Leitos de hospital-dia',
  QTINST11: 'Salas de higienização',
  QTINST12: 'Salas de coleta de material clínico',
  QTINST13: 'Salas de espera',
  QTINST14: 'Salas de atendimento ambulatorial',
  QTINST15: 'Consultórios indiferenciados',
  QTINST16: 'Salas de pequenas cirurgias',
  QTINST17: 'Salas de gesso',
  QTINST18: 'Salas de repouso/observação indiferenciada',
  QTINST19: 'Salas de sutura',
  QTINST20: 'Salas de nebulização',
  QTINST21: 'Salas de triagem',
  QTINST22: 'Salas de inalação',
  QTINST23: 'Salas de imunização',
  QTINST24: 'Salas de coleta/recepção de exames',
  QTINST25: 'Salas de reidratação',
  QTINST26: 'Salas de imunização (vacinação)',
  QTINST27: 'Consultórios de enfermagem',
  QTINST28: 'Consultórios de nutrição',
  QTINST29: 'Salas de curativo',
  QTINST30: 'Salas de eletrocardiografia',
  QTINST31: 'Salas de endoscopia',
  QTINST32: 'Salas de fisioterapia',
  QTINST33: 'Salas de radiologia',
  QTINST34: 'Salas de ultrassonografia',
  QTINST35: 'Salas de tomografia',
  QTINST36: 'Salas de ressonância magnética',
  QTINST37: 'Outras salas especializadas',
};

export interface InstalacaoContagem {
  /** Código da instalação (ex: "QTINST15"). */
  codigo: string;
  /** Quantidade de unidades dessa instalação no estabelecimento. */
  quantidade: number;
  /** Rótulo pt-BR; null quando o código não está mapeado. */
  rotulo: null | string;
}

/**
 * Extrai todas as instalações com `quantidade > 0` a partir do registro
 * CNES-ST, retornando com rótulo pt-BR. Campos ausentes ou zero são
 * omitidos pra manter o output enxuto.
 */
export function labelInstalacoes(record: Record<string, unknown>): readonly InstalacaoContagem[] {
  const out: InstalacaoContagem[] = [];
  for (const [codigo, rotulo] of Object.entries(INSTALACOES_LABELS)) {
    const raw = record[codigo];
    const quantidade = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(quantidade) || quantidade <= 0) continue;
    out.push({ codigo, quantidade, rotulo });
  }
  return out;
}
