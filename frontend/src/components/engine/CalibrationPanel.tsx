import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatPercent } from '@/lib/format'
import type { EngineCalibration } from '@/types/api'

export function CalibrationPanel() {
  const { data } = useQuery({
    queryKey: ['engine-calibration'],
    queryFn: async () => (await api.get<EngineCalibration>('/auto-trading/calibration')).data,
  })

  return (
    <Card>
      <CardHeader><CardTitle>Confidence calibration</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted">Does stated confidence match actual win rate? Entry confidence matched to each closed trade by the most recent order.</p>
        {!data?.sufficient && (
          <p className="text-sm text-muted">
            Calibration needs at least {data?.min_required ?? 10} closed trades to be meaningful ({data?.total_closed ?? 0} so far).
          </p>
        )}
        {data?.sufficient && data.buckets.map((b) => (
          <div key={b.range} className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0 text-muted">{b.range}</span>
            <span className="h-2.5 rounded bg-primary" style={{ width: `${b.win_rate * 100}%` }} />
            <span className="w-14 text-foreground">{formatPercent(b.win_rate)}</span>
            <span className="text-xs text-muted">({b.trades})</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
