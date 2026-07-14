import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { useEngineMetrics } from '@/hooks/useEngineMetrics'

export function DecisionBreakdownPanel() {
  const { data } = useEngineMetrics()
  const rows = data?.decision_breakdown ?? []
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0)

  return (
    <Card>
      <CardHeader><CardTitle>Decision breakdown</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 && <p className="text-sm text-muted">No decisions recorded yet.</p>}
        {rows.map((r) => (
          <div key={r.action} className="flex items-center gap-3 text-sm">
            <span className="w-44 shrink-0 text-right text-muted">{r.action}</span>
            <span className="h-2.5 rounded bg-primary" style={{ width: `${max > 0 ? (r.count / max) * 100 : 0}%` }} />
            <span className="w-10 text-foreground">{r.count}</span>
          </div>
        ))}
        {data?.avg_confidence != null && (
          <p className="text-xs text-muted">Avg confidence across decisions: {formatNumber(data.avg_confidence, 0)}%</p>
        )}
      </CardContent>
    </Card>
  )
}
