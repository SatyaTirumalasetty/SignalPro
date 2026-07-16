import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatDate, formatNumber, signalBadgeVariant } from '@/lib/format'
import type { AutoTradingRun, AutoTradingSettings, AutoTradingStatus, BrokerConnection } from '@/types/api'

const TIMEFRAMES = ['15m', '1h', '4h', '1d']

// Mirrors CIRCUIT_BREAKER_ERROR_THRESHOLD in backend/src/services/autoTradingEngine.js
const CIRCUIT_BREAKER_ERROR_THRESHOLD = 5

const actionVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  order_placed: 'success',
  error: 'danger',
  auto_disabled_errors: 'danger',
}

export function AutoTradingPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [symbolInput, setSymbolInput] = useState('')
  const [formEdits, setFormEdits] = useState<AutoTradingSettings | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () => (await api.get<{ settings: AutoTradingSettings }>('/auto-trading/settings')).data.settings,
  })

  const statusQuery = useQuery({
    queryKey: ['auto-trading-status'],
    queryFn: async () => (await api.get<AutoTradingStatus>('/auto-trading/status')).data,
    refetchInterval: 60_000,
  })

  const connectionsQuery = useQuery({
    queryKey: ['broker-connections'],
    queryFn: async () => (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections,
  })

  const activityQuery = useQuery({
    queryKey: ['auto-trading-activity'],
    queryFn: async () => (await api.get<{ runs: AutoTradingRun[]; total: number }>('/auto-trading/activity', { params: { limit: 50 } })).data,
    refetchInterval: 60_000,
  })

  // Local edits take precedence; before the user touches anything, mirror the server settings.
  const form = formEdits ?? settingsQuery.data ?? null

  const saveMutation = useMutation({
    mutationFn: (payload: AutoTradingSettings) => api.put<{ settings: AutoTradingSettings }>('/auto-trading/settings', payload),
    onSuccess: (res) => {
      setFormEdits(res.data.settings)
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] })
      queryClient.invalidateQueries({ queryKey: ['auto-trading-status'] })
      toast('Auto-trading settings saved', 'success')
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const connections = connectionsQuery.data ?? []
  const connectedConnections = connections.filter((c) => c.status === 'connected')

  if (!form) {
    return <p className="text-sm text-muted">Loading…</p>
  }

  const status = statusQuery.data
  const activity = activityQuery.data?.runs ?? []
  const wasAutoDisabled = !form.enabled && activity[0]?.action === 'auto_disabled_errors'

  const addSymbol = () => {
    const symbol = symbolInput.trim().toUpperCase()
    if (!symbol || form.symbols.includes(symbol)) {
      setSymbolInput('')
      return
    }
    setFormEdits({ ...form, symbols: [...form.symbols, symbol] })
    setSymbolInput('')
  }

  const removeSymbol = (symbol: string) => {
    setFormEdits({ ...form, symbols: form.symbols.filter((s) => s !== symbol) })
  }

  const toggleTimeframe = (tf: string) => {
    const timeframes = form.timeframes.includes(tf)
      ? form.timeframes.filter((t) => t !== tf)
      : [...form.timeframes, tf]
    setFormEdits({ ...form, timeframes })
  }

  const handleSave = () => {
    saveMutation.mutate(form)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Auto Trading</h1>
        <p className="text-sm text-muted">
          Let SignalPro continuously analyze your watchlist and place trades automatically through your connected broker.
        </p>
      </div>

      {wasAutoDisabled && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          Auto-trading was automatically disabled after {CIRCUIT_BREAKER_ERROR_THRESHOLD} consecutive errors. Review
          the activity log below, resolve the issue, then re-enable it in Settings.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Status" value={status?.enabled ? 'Enabled' : 'Disabled'} tone={status?.enabled ? 'success' : undefined} />
        <Stat label="Last run" value={formatDate(status?.last_run_at)} />
        <Stat label="Trades today" value={formatNumber(status?.trades_today, 0)} />
        <Stat
          label="Today's P&L"
          value={formatNumber(status?.todays_pnl)}
          tone={status && status.todays_pnl >= 0 ? 'success' : 'danger'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 sm:w-1/2">
            <div>
              <p className="text-sm font-medium text-foreground">Enable auto-trading</p>
              <p className="text-sm text-muted">Runs every ~15 minutes against your configured watchlist.</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(enabled) => setFormEdits({ ...form, enabled })} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Broker connection</label>
              <Select
                value={form.broker_connection_id ?? ''}
                onValueChange={(value) => setFormEdits({ ...form, broker_connection_id: value || null })}
                placeholder="Select a broker connection"
                options={connectedConnections.map((c) => ({ value: c.id, label: `${c.name} (${c.broker_id})` }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Min confidence (%)</label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.min_confidence}
                onChange={(e) => setFormEdits({ ...form, min_confidence: Number(e.target.value) })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Risk per trade (%)</label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={form.risk_per_trade_pct * 100}
                onChange={(e) => setFormEdits({ ...form, risk_per_trade_pct: Number(e.target.value) / 100 })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Max daily loss (%)</label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={form.max_daily_loss_pct * 100}
                onChange={(e) => setFormEdits({ ...form, max_daily_loss_pct: Number(e.target.value) / 100 })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Cooldown (minutes)</label>
              <Input
                type="number"
                min="1"
                max="1440"
                value={form.cooldown_minutes}
                onChange={(e) => setFormEdits({ ...form, cooldown_minutes: Number(e.target.value) })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Max trades per day</label>
              <Input
                type="number"
                min="1"
                max="100"
                value={form.max_trades_per_day}
                onChange={(e) => setFormEdits({ ...form, max_trades_per_day: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Timeframes</label>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => toggleTimeframe(tf)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    form.timeframes.includes(tf)
                      ? 'border-primary bg-primary/20 text-primary'
                      : 'border-border bg-card text-muted hover:text-foreground'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Watchlist symbols</label>
            <div className="flex flex-wrap gap-2">
              {form.symbols.map((symbol) => (
                <span
                  key={symbol}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-sm text-foreground"
                >
                  {symbol}
                  <button type="button" onClick={() => removeSymbol(symbol)} className="text-muted hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 sm:w-1/2">
              <Input
                placeholder="Add symbol (e.g. AAPL)"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addSymbol()
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addSymbol}>
                Add
              </Button>
            </div>
          </div>

          <div>
            <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activityQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {!activityQuery.isLoading && activity.length === 0 && (
            <p className="text-sm text-muted">No auto-trading activity yet.</p>
          )}
          {activity.length > 0 && (
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Timeframe</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Reasoning</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-muted">{formatDate(run.created_at)}</TableCell>
                    <TableCell>{run.symbol}</TableCell>
                    <TableCell className="text-muted">{run.timeframe}</TableCell>
                    <TableCell>
                      {run.decision ? <Badge variant={signalBadgeVariant(run.decision)}>{run.decision}</Badge> : '—'}
                    </TableCell>
                    <TableCell>{run.confidence != null ? `${formatNumber(run.confidence, 0)}%` : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={actionVariant[run.action] ?? 'muted'}>{run.action}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted" title={run.reasoning || run.error_message || ''}>
                      {run.reasoning || run.error_message || '—'}
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

function Stat({ label, value, tone }: { label: string; value: string | number | undefined; tone?: 'success' | 'danger' }) {
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
