import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatCurrency, formatDate, formatPercent, signalBadgeVariant } from '@/lib/format'
import type { Signal } from '@/types/api'

export function SignalsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [symbol, setSymbol] = useState('')
  const [timeframe, setTimeframe] = useState('1h')
  const [error, setError] = useState<string | null>(null)
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null)

  const signalsQuery = useQuery({
    queryKey: ['signals'],
    queryFn: async () => (await api.get<{ signals: Signal[] }>('/analysis/signals')).data.signals,
  })

  const generateMutation = useMutation({
    mutationFn: (payload: { symbol: string; timeframe: string }) =>
      api.post<{ signal: Signal }>('/analysis/generate', payload),
    onSuccess: ({ data }) => {
      toast(`Signal generated for ${data.signal.symbol}`, 'success')
      queryClient.invalidateQueries({ queryKey: ['signals'] })
      setSymbol('')
      setError(null)
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const handleGenerate = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    generateMutation.mutate({ symbol: symbol.toUpperCase(), timeframe })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AI Signals</h1>
          <p className="text-sm text-muted">Claude-generated trading signals and analysis</p>
        </div>
        <Link to="/signals/performance" className="text-sm text-primary hover:underline">
          View performance
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate a new signal</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleGenerate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Symbol</label>
              <Input placeholder="e.g. AAPL" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
              >
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
                <option value="4h">4 hours</option>
              </select>
            </div>
            <Button type="submit" disabled={generateMutation.isPending}>
              {generateMutation.isPending ? 'Generating…' : 'Generate signal'}
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signal history</CardTitle>
        </CardHeader>
        <CardContent>
          {signalsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {signalsQuery.data?.length === 0 && <p className="text-sm text-muted">No signals yet.</p>}
          {!!signalsQuery.data?.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {signalsQuery.data.map((signal) => (
                  <TableRow key={signal.id}>
                    <TableCell className="font-medium text-foreground">{signal.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={signalBadgeVariant(signal.signal_type)}>{signal.signal_type}</Badge>
                    </TableCell>
                    <TableCell>{formatPercent(signal.confidence)}</TableCell>
                    <TableCell>{formatCurrency(signal.entry_price)}</TableCell>
                    <TableCell>{formatCurrency(signal.take_profit)}</TableCell>
                    <TableCell className="text-muted">{formatDate(signal.created_at)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setActiveSignal(signal)}>
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SignalDetailDialog signal={activeSignal} onClose={() => setActiveSignal(null)} />
    </div>
  )
}

function SignalDetailDialog({ signal, onClose }: { signal: Signal | null; onClose: () => void }) {
  return (
    <Dialog open={!!signal} onClose={onClose} title={signal ? `${signal.symbol} signal` : ''}>
      {signal && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={signalBadgeVariant(signal.signal_type)}>{signal.signal_type}</Badge>
            <span className="text-muted">{formatPercent(signal.confidence)} confidence</span>
            <Badge variant="muted">{signal.timeframe}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entry" value={formatCurrency(signal.entry_price)} />
            <Field label="Stop loss" value={formatCurrency(signal.stop_loss)} />
            <Field label="Take profit" value={formatCurrency(signal.take_profit)} />
            <Field label="Predicted range" value={`${formatCurrency(signal.predicted_price_low)} – ${formatCurrency(signal.predicted_price_high)}`} />
          </div>
          {signal.analysis_text && (
            <div>
              <div className="mb-1 text-xs uppercase text-muted">Analysis</div>
              <p className="whitespace-pre-wrap text-foreground">{signal.analysis_text}</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  )
}
