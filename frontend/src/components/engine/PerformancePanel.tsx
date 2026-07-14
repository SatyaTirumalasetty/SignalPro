import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BenchmarkChart } from '@/components/BenchmarkChart'
import { api } from '@/lib/api'
import { formatPercent } from '@/lib/format'
import { useEngineMetrics } from '@/hooks/useEngineMetrics'
import type { BenchmarkPoint } from '@/types/api'

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`)

export function PerformancePanel() {
  const { data: metrics } = useEngineMetrics()
  const benchmarkQuery = useQuery({
    queryKey: ['engine-benchmark'],
    queryFn: async () => (await api.get<{ series: BenchmarkPoint[] }>('/auto-trading/benchmark')).data.series,
  })
  const p = metrics?.performance
  const series = benchmarkQuery.data ?? []

  return (
    <Card>
      <CardHeader><CardTitle>Performance vs buy-and-hold</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Return" value={pct(p?.return_pct ?? null)} tone={p && p.return_pct != null && p.return_pct >= 0 ? 'success' : 'danger'} />
          <Kpi label="vs buy-and-hold" value={pct(p?.vs_buy_hold_pct ?? null)} tone={p && p.vs_buy_hold_pct != null && p.vs_buy_hold_pct >= 0 ? 'success' : 'danger'} />
          <Kpi label="Win rate" value={p?.win_rate != null ? formatPercent(p.win_rate) : '—'} />
          <Kpi label="Trades" value={p ? String(p.trades) : '—'} />
        </div>
        {series.length > 1 ? (
          <BenchmarkChart series={series} />
        ) : (
          <p className="text-sm text-muted">The engine-vs-buy-and-hold chart appears after the second daily snapshot.</p>
        )}
      </CardContent>
    </Card>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>{value}</div>
    </div>
  )
}
