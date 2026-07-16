import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { useEngineMetrics } from '@/hooks/useEngineMetrics'

export function HealthStrip() {
  const { data } = useEngineMetrics()
  const h = data?.health

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Tile label="Status" value={h ? (h.enabled ? 'Enabled' : 'Disabled') : '—'} tone={h?.enabled ? 'success' : undefined} />
      <Tile label="Last cycle" value={formatDate(h?.last_run_at)} />
      <Tile
        label="Errors 24h"
        value={h ? `${h.errors_24h} / ${h.circuit_breaker_threshold}` : '—'}
        tone={h && h.errors_24h >= h.circuit_breaker_threshold ? 'danger' : undefined}
      />
      <Tile label="Trades today" value={h ? h.trades_today : '—'} />
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: 'success' | 'danger' }) {
  return (
    <Card>
      <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
      <CardContent className={`text-2xl font-semibold ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>
        {value}
      </CardContent>
    </Card>
  )
}
