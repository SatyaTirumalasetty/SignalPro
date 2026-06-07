import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatNumber, formatPercent, signalBadgeVariant } from '@/lib/format'
import type { AdminSignalOverall, AdminSignalStat } from '@/types/api'

export function AdminSignalsPage() {
  const performanceQuery = useQuery({
    queryKey: ['admin-signal-performance'],
    queryFn: async () =>
      (await api.get<{ by_symbol: AdminSignalStat[]; overall: AdminSignalOverall }>('/admin/signals/performance')).data,
  })

  const overall = performanceQuery.data?.overall
  const bySymbol = performanceQuery.data?.by_symbol ?? []

  const overallCards = overall
    ? [
        { label: 'Total signals', value: formatNumber(Number(overall.total), 0) },
        { label: 'Avg. confidence', value: formatPercent(overall.avg_confidence) },
        { label: 'Tokens used', value: formatNumber(Number(overall.total_tokens), 0) },
        { label: 'Unique users', value: formatNumber(Number(overall.unique_users), 0) },
      ]
    : []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Signal performance</h1>
        <p className="text-sm text-muted">AI signal generation activity and accuracy</p>
      </div>

      {performanceQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}

      {!!overallCards.length && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {overallCards.map((c) => (
            <Card key={c.label}>
              <CardHeader>
                <CardTitle>{c.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-foreground">{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>By symbol</CardTitle>
        </CardHeader>
        <CardContent>
          {!performanceQuery.isLoading && bySymbol.length === 0 && <p className="text-sm text-muted">No signal data yet.</p>}
          {!!bySymbol.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Avg. confidence</TableHead>
                  <TableHead>Executed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySymbol.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-foreground">{s.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={signalBadgeVariant(s.signal_type)}>{s.signal_type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted">{formatNumber(s.total, 0)}</TableCell>
                    <TableCell className="text-muted">{formatPercent(s.avg_confidence)}</TableCell>
                    <TableCell className="text-muted">{formatNumber(s.executed, 0)}</TableCell>
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
