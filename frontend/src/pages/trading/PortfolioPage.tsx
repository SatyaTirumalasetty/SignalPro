import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { PortfolioSummary } from '@/types/api'

export function PortfolioPage() {
  const portfolioQuery = useQuery({
    queryKey: ['portfolio'],
    queryFn: async () => (await api.get<PortfolioSummary>('/trading/portfolio')).data,
  })

  const data = portfolioQuery.data
  const summary = data?.summary

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Portfolio</h1>
        <p className="text-sm text-muted">Your holdings grouped by symbol</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Open positions" value={summary?.open_positions} />
        <SummaryCard label="Closed positions" value={summary?.closed_positions} />
        <SummaryCard
          label="Unrealized P&L"
          value={summary ? formatCurrency(summary.unrealized_pnl) : undefined}
          tone={summary && summary.unrealized_pnl < 0 ? 'danger' : 'success'}
        />
        <SummaryCard
          label="Realized P&L"
          value={summary ? formatCurrency(summary.realized_pnl) : undefined}
          tone={summary && summary.realized_pnl < 0 ? 'danger' : 'success'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          {portfolioQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {data?.positions.length === 0 && <p className="text-sm text-muted">No holdings yet.</p>}
          {!!data?.positions.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Total Qty</TableHead>
                  <TableHead>Avg Entry</TableHead>
                  <TableHead>Total P&amp;L</TableHead>
                  <TableHead>Positions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((row) => (
                  <TableRow key={`${row.symbol}-${row.position_type}`}>
                    <TableCell className="font-medium text-foreground">{row.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={row.position_type === 'long' ? 'success' : 'danger'}>{row.position_type}</Badge>
                    </TableCell>
                    <TableCell>{formatNumber(row.total_quantity)}</TableCell>
                    <TableCell>{formatCurrency(row.avg_entry)}</TableCell>
                    <TableCell className={row.total_pnl >= 0 ? 'text-success' : 'text-danger'}>
                      {formatCurrency(row.total_pnl)}
                    </TableCell>
                    <TableCell>{row.position_count}</TableCell>
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

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number | undefined
  tone?: 'success' | 'danger'
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent
        className={`text-2xl font-semibold ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground'}`}
      >
        {value ?? '—'}
      </CardContent>
    </Card>
  )
}
