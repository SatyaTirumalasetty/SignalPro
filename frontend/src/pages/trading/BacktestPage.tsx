import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { BacktestResult } from '@/types/api'

export function BacktestPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [timeframe, setTimeframe] = useState('1d')
  const [bars, setBars] = useState('300')
  const [initialEquity, setInitialEquity] = useState('100000')
  const [error, setError] = useState<string | null>(null)

  const runMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<BacktestResult>('/backtest/run', payload),
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    runMutation.mutate({
      symbol: symbol.toUpperCase(),
      timeframe,
      bars: Number(bars),
      initial_equity: Number(initialEquity),
    })
  }

  const result = runMutation.data?.data
  const summary = result?.summary

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Backtest</h1>
        <p className="text-sm text-muted">
          Run the baseline SMA/RSI strategy against historical data to evaluate performance before paper trading.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run a backtest</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Input placeholder="Symbol (e.g. AAPL)" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
            >
              <option value="1d">1 day</option>
              <option value="1h">1 hour</option>
              <option value="15m">15 minutes</option>
              <option value="5m">5 minutes</option>
            </select>
            <Input
              type="number"
              placeholder="Bars"
              value={bars}
              onChange={(e) => setBars(e.target.value)}
              min="50"
              max="1000"
              step="1"
            />
            <Input
              type="number"
              placeholder="Initial equity"
              value={initialEquity}
              onChange={(e) => setInitialEquity(e.target.value)}
              min="0"
              step="any"
            />
            <div className="sm:col-span-4">
              <Button type="submit" disabled={runMutation.isPending}>
                {runMutation.isPending ? 'Running…' : 'Run backtest'}
              </Button>
            </div>
          </form>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </CardContent>
      </Card>

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total trades" value={summary.total_trades} />
            <Stat label="Win rate" value={`${formatNumber(summary.win_rate, 1)}%`} />
            <Stat
              label="Total return"
              value={`${formatNumber(summary.total_return_pct, 2)}%`}
              tone={summary.total_return_pct >= 0 ? 'success' : 'danger'}
            />
            <Stat label="Max drawdown" value={`${formatNumber(summary.max_drawdown_pct, 2)}%`} tone="danger" />
            <Stat label="Initial equity" value={formatNumber(summary.initial_equity, 2)} />
            <Stat label="Final equity" value={formatNumber(summary.final_equity, 2)} />
            <Stat label="Avg win" value={formatNumber(summary.avg_win, 2)} tone="success" />
            <Stat label="Avg loss" value={formatNumber(summary.avg_loss, 2)} tone="danger" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Trades</CardTitle>
            </CardHeader>
            <CardContent>
              {result.trades.length === 0 && <p className="text-sm text-muted">No trades were generated for this window.</p>}
              {result.trades.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entry time</TableHead>
                      <TableHead>Exit time</TableHead>
                      <TableHead>Entry price</TableHead>
                      <TableHead>Exit price</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>P&amp;L</TableHead>
                      <TableHead>Exit reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.trades.map((trade, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted">{formatDate(trade.entry_time)}</TableCell>
                        <TableCell className="text-muted">{formatDate(trade.exit_time)}</TableCell>
                        <TableCell>{formatNumber(trade.entry_price)}</TableCell>
                        <TableCell>{formatNumber(trade.exit_price)}</TableCell>
                        <TableCell>{formatNumber(trade.quantity, 0)}</TableCell>
                        <TableCell className={trade.pnl >= 0 ? 'text-success' : 'text-danger'}>
                          {formatNumber(trade.pnl)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={trade.exit_reason === 'take_profit' ? 'success' : trade.exit_reason === 'stop_loss' ? 'danger' : 'muted'}>
                            {trade.exit_reason}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Equity curve</CardTitle>
            </CardHeader>
            <CardContent>
              {result.equity_curve.length > 0 ? (
                <EquityCurve points={result.equity_curve.map((p) => p.equity)} />
              ) : (
                <p className="text-sm text-muted">No equity curve data.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({
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

function EquityCurve({ points }: { points: number[] }) {
  const width = 600
  const height = 160
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1

  const path = points
    .map((value, i) => {
      const x = (i / (points.length - 1 || 1)) * width
      const y = height - ((value - min) / range) * height
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const isPositive = points[points.length - 1] >= points[0]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={isPositive ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)'} strokeWidth={2} />
    </svg>
  )
}
