import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format'
import type { EngineSymbolPerformanceRow } from '@/types/api'

export function SymbolPerformanceTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['engine-symbol-performance'],
    queryFn: async () => (await api.get<{ symbols: EngineSymbolPerformanceRow[] }>('/auto-trading/symbol-performance')).data.symbols,
  })
  const rows = data ?? []

  return (
    <Card>
      <CardHeader><CardTitle>Per-symbol performance</CardTitle></CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!isLoading && rows.length === 0 && <p className="text-sm text-muted">No per-symbol activity yet.</p>}
        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Trades</TableHead>
                <TableHead>Win %</TableHead>
                <TableHead>Realized P&amp;L</TableHead>
                <TableHead>Unrealized P&amp;L</TableHead>
                <TableHead>Avg conf</TableHead>
                <TableHead>Last action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.symbol}>
                  <TableCell className="font-medium text-foreground">{r.symbol}</TableCell>
                  <TableCell>{r.trades}</TableCell>
                  <TableCell>{r.win_rate != null ? formatPercent(r.win_rate) : '—'}</TableCell>
                  <TableCell className={r.realized_pnl >= 0 ? 'text-success' : 'text-danger'}>{formatCurrency(r.realized_pnl)}</TableCell>
                  <TableCell className={r.unrealized_pnl >= 0 ? 'text-success' : 'text-danger'}>{formatCurrency(r.unrealized_pnl)}</TableCell>
                  <TableCell>{r.avg_confidence != null ? `${formatNumber(r.avg_confidence, 0)}%` : '—'}</TableCell>
                  <TableCell className="text-muted">{r.last_action ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
