import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TrendPoint } from '@/lib/queries';

export interface TrendSeries {
  /** Cor de linha — passe um valor CSS válido (hex, rgb ou var(--token)). */
  color: string;
  id: string;
  /** Label exibido na legenda e tooltip. */
  label: string;
}

export interface TrendChartProps {
  data: TrendPoint[];
  series: TrendSeries[];
}

const NF_INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const NF_BRL = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  maximumFractionDigits: 0,
  style: 'currency',
});

const VALOR_SUFFIX = '__valor';

function formatCompetenciaShort(competencia: string): string {
  // YYYY-MM → MMM/YY (pt-BR)
  const [yyyy, mm] = competencia.split('-');
  if (!yyyy || !mm) return competencia;
  const month = new Date(Number(yyyy), Number(mm) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'short',
  });
  return `${month.replace('.', '')}/${yyyy.slice(2)}`;
}

interface PivotedRow {
  [k: string]: number | string;
  competencia: string;
  label: string;
}

export function TrendChart({ data, series }: TrendChartProps) {
  const pivoted = useMemo<PivotedRow[]>(() => {
    if (series.length === 0) return [];
    const byCompetencia = new Map<string, PivotedRow>();
    for (const row of data) {
      const existing = byCompetencia.get(row.competencia) ?? {
        competencia: row.competencia,
        label: formatCompetenciaShort(row.competencia),
      };
      existing[row.seriesId] = row.volumeExames;
      existing[`${row.seriesId}${VALOR_SUFFIX}`] = row.valorAprovadoBRL;
      byCompetencia.set(row.competencia, existing);
    }
    return [...byCompetencia.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
  }, [data, series]);

  if (pivoted.length === 0 || series.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[320px] items-center justify-center font-sans text-sm">
        Sem dados para a seleção atual.
      </div>
    );
  }

  const formatVolume = (v: number): string => NF_INT.format(v);

  // Cores literais (não tokens CSS) — recharts injeta os atributos no SVG e
  // variáveis CSS não são resolvidas em atributos de elementos SVG. Padrão
  // copiado de platform/apps/web/src/components/biomarker-history-chart.
  const gridColor = 'rgba(0,0,0,0.08)';
  const textColor = '#71717a';

  return (
    <div className="font-sans">
      <ResponsiveContainer height={360} width="100%">
        <LineChart data={pivoted} margin={{ bottom: 8, left: 8, right: 16, top: 8 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
          <XAxis
            axisLine={{ stroke: gridColor }}
            dataKey="label"
            interval="preserveStartEnd"
            minTickGap={32}
            tick={{ fill: textColor, fontSize: 11 }}
            tickLine={{ stroke: gridColor }}
          />
          <YAxis
            axisLine={false}
            tick={{ fill: textColor, fontSize: 11 }}
            tickFormatter={formatVolume}
            tickLine={false}
            width={80}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--card)',
              border: `1px solid ${gridColor}`,
              borderRadius: 6,
              fontFamily: "'Roboto', system-ui, sans-serif",
              fontSize: 12,
            }}
            cursor={{ stroke: gridColor, strokeWidth: 1 }}
            formatter={(value, name, item) => {
              const row = (item as { payload?: PivotedRow }).payload;
              // `name` é a label da série; o `dataKey` da Line está em `item.dataKey`.
              const id = (item as { dataKey?: string }).dataKey ?? '';
              const valor = row?.[`${id}${VALOR_SUFFIX}`];
              const volumeText = formatVolume(Number(value));
              const valorText = typeof valor === 'number' ? NF_BRL.format(valor) : '—';
              return [`${volumeText} exames · ${valorText}`, String(name)];
            }}
            labelFormatter={(label) => String(label ?? '')}
          />
          <Legend
            iconType="plainline"
            wrapperStyle={{
              color: textColor,
              fontFamily: "'Roboto', system-ui, sans-serif",
              fontSize: 12,
              paddingTop: 12,
            }}
          />
          {series.map((s) => (
            <Line
              dataKey={s.id}
              dot={false}
              isAnimationActive={false}
              key={s.id}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              type="monotone"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
