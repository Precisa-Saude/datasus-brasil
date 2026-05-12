import { useEffect, useState } from 'react';

import type { AnomalyHit } from '@/lib/anomaly';
import { formatCompetencia } from '@/lib/format';
import type { CnesBreakdownRow } from '@/lib/queries';
import { fetchCnesBreakdown } from '@/lib/queries';

const NF_INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const NF_BRL = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  maximumFractionDigits: 0,
  style: 'currency',
});

export interface CnesBreakdownProps {
  hit: AnomalyHit;
  labelForLoinc: (loinc: string) => string;
  onClose: () => void;
}

/**
 * Painel de detalhamento por estabelecimento (CNES) para uma tupla
 * (município × exame × competência). Consulta o parquet bruto SIA-PA
 * sob demanda — um Range Request, sem alterar o agregado consumido
 * pelo resto do site.
 *
 * Mostra o CNES bruto (7 dígitos). A resolução de nome do
 * estabelecimento depende do dataset CNES-ST, que ainda não é
 * publicado pelo `datasus-parquet`; quando estiver, plugar aqui sem
 * mudar a query.
 */
export function CnesBreakdown({ hit, labelForLoinc, onClose }: CnesBreakdownProps) {
  const [rows, setRows] = useState<CnesBreakdownRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<null | string>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows(null);
    fetchCnesBreakdown({
      competencia: hit.competencia,
      ibgeCode6: hit.municipioCode.slice(0, 6),
      loinc: hit.loinc,
      ufSigla: hit.ufSigla,
    }).then(
      (data) => {
        if (cancelled) return;
        setRows(data);
        setLoading(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hit.competencia, hit.loinc, hit.municipioCode, hit.ufSigla]);

  const totalVolume = rows?.reduce((acc, r) => acc + r.volumeExames, 0) ?? 0;
  const totalValor = rows?.reduce((acc, r) => acc + r.valorAprovadoBRL, 0) ?? 0;

  return (
    <div className="border-border bg-card mt-3 rounded-lg border p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-sans text-sm font-semibold tracking-tight">
            Distribuição por estabelecimento (CNES)
          </h3>
          <p className="text-muted-foreground mt-0.5 font-sans text-xs">
            {hit.municipioNome} · {hit.ufSigla} · {formatCompetencia(hit.competencia)} ·{' '}
            {labelForLoinc(hit.loinc)}
          </p>
        </div>
        <button
          aria-label="Fechar detalhamento"
          className="text-muted-foreground hover:text-foreground font-sans text-xs transition-colors"
          onClick={onClose}
          type="button"
        >
          Fechar
        </button>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex h-[120px] items-center justify-center gap-3 font-sans text-xs">
          <div className="border-muted-foreground/30 border-t-primary size-4 animate-spin rounded-full border-2" />
          Consultando parquet bruto SIA-PA…
        </div>
      ) : null}

      {!loading && error !== null ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-3 font-sans text-xs">
          <p className="font-medium">Não foi possível carregar o detalhamento.</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : null}

      {!loading && error === null && rows !== null ? (
        rows.length === 0 ? (
          <p className="text-muted-foreground font-sans text-xs">
            Nenhuma linha encontrada no parquet bruto para essa tupla. O agregado pode estar
            defasado em relação à competência atual do FTP DATASUS.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full font-sans text-xs">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left text-[11px] font-medium uppercase tracking-wide">
                  <th className="px-3 py-2">Estabelecimento (CNES)</th>
                  <th className="px-3 py-2 text-right">Volume</th>
                  <th className="px-3 py-2 text-right">Valor aprovado</th>
                  <th className="px-3 py-2 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr className="border-border/50 border-b" key={r.cnes}>
                    <td className="px-3 py-2 font-mono">{r.cnes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {NF_INT.format(r.volumeExames)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">
                      {NF_BRL.format(r.valorAprovadoBRL)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">
                      {totalVolume > 0
                        ? `${((100 * r.volumeExames) / totalVolume).toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="px-3 py-2">Total ({rows.length} CNES)</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {NF_INT.format(totalVolume)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{NF_BRL.format(totalValor)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tbody>
            </table>
            <p className="text-muted-foreground mt-3 font-sans text-[11px]">
              Fonte: SIA-PA (parquet bruto, coluna <code>PA_CODUNI</code>). Diferenças entre o total
              acima e o volume mostrado na linha do explorador indicam que o agregado pode estar
              defasado em relação à publicação atual do DATASUS para essa competência.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
