import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatNumber, formatPercent, signalBadgeVariant } from '@/lib/format'
import type { SignalPerformance } from '@/types/api'

export function SignalPerformancePage() {
  const performanceQuery = useQuery({
    queryKey: ['signal-performance'],
    queryFn: async () => (await api.get<SignalPerformance>('/analysis/performance')).data,
  })

  const data = performanceQuery.data
  const overall = data?.overall

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Signal performance</h1>
        <p className="text-sm text-muted">How AI-generated signals have performed over time</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total signals" value={overall?.total_signals} />
        <Stat label="Executed" value={overall?.executed} />
        <Stat label="Avg confidence" value={overall ? formatPercent(overall.avg_confidence) : undefined} />
        <Stat label="Tokens used" value={overall ? formatNumber(overall.total_tokens_used, 0) : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By signal type</CardTitle>
        </CardHeader>
        <CardContent>
          {performanceQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {data?.by_type.length === 0 && <p className="text-sm text-muted">No signal data yet.</p>}
          {!!data?.by_type.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Executed</TableHead>
                  <TableHead>Avg confidence</TableHead>
                  <TableHead>Avg P&amp;L %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.by_type.map((row) => (
                  <TableRow key={row.signal_type}>
                    <TableCell>
                      <Badge variant={signalBadgeVariant(row.signal_type)}>{row.signal_type}</Badge>
                    </TableCell>
                    <TableCell>{row.total}</TableCell>
                    <TableCell>{row.executed}</TableCell>
                    <TableCell>{formatPercent(row.avg_confidence)}</TableCell>
                    <TableCell className={row.avg_pnl_percent >= 0 ? 'text-success' : 'text-danger'}>
                      {formatPercent(row.avg_pnl_percent)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold text-foreground">{value ?? '—'}</CardContent>
    </Card>
  )
}
