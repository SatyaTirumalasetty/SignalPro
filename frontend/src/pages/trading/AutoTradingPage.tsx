import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Collapsible } from '@/components/ui/collapsible'
import { BenchmarkChart } from '@/components/BenchmarkChart'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatDate, formatNumber, signalBadgeVariant } from '@/lib/format'
import type { AiMode, AutoTradingRun, AutoTradingSettings, AutoTradingStatus, BenchmarkPoint, BrokerConnection } from '@/types/api'

const TIMEFRAMES = ['15m', '1h', '4h', '1d']

const AI_MODES: { value: AiMode; label: string; blurb: string; description: string }[] = [
  {
    value: 'minimize',
    label: 'Minimize cost',
    blurb: 'Cheapest — small model, trimmed context.',
    description:
      'Uses the small model with a trimmed context (2 timeframes, fewer candles, no news). Rough cost: cents per day for a small watchlist. Best for proving the loop works; expect noticeably weaker analysis and more conservative decisions.',
  },
  {
    value: 'balanced',
    label: 'Balanced (default)',
    blurb: 'Strong model with prompt caching on every decision.',
    description:
      'Every symbol gets a full fused multi-timeframe analysis from the standard decision model, with prompt caching to keep repeat costs down. Rough cost: tens of dollars per month at a 5–10 symbol watchlist on 15-minute cycles. The recommended starting point.',
  },
  {
    value: 'tiered',
    label: 'Tiered by stakes',
    blurb: 'Cheap screening pass; the strong model only sees candidates.',
    description:
      'A small model first screens the watchlist for actionable setups; only screened-in symbols (and every open position) get the full decision model. Best cost/quality ratio for larger watchlists — but adds a screening step that can miss subtle setups.',
  },
  {
    value: 'max',
    label: 'Max intelligence',
    blurb: 'Top model with extended thinking on every decision.',
    description:
      'The top model reasons step-by-step (extended thinking) over the full context for every decision. Highest analysis quality and the highest cost — can reach hundreds of dollars per month on large watchlists with frequent cycles. Use when decision quality matters more than spend.',
  },
]

const AUTHORITY_OPTIONS: { key: keyof AutoTradingSettings['authority']; label: string; description: string }[] = [
  {
    key: 'close',
    label: 'Close positions',
    description:
      'The engine may fully close a position when its analysis turns against it — the core of autonomous risk control. On by default. With this off, exits rely entirely on the stop-loss/take-profit placed at entry.',
  },
  {
    key: 'adjust_stop',
    label: 'Adjust stops',
    description:
      'The engine may tighten a stop-loss (e.g. trail it to breakeven) as a trade evolves. It can never widen a stop — that is enforced in code, not left to the AI.',
  },
  {
    key: 'partial_exit',
    label: 'Partial exits',
    description:
      'The engine may scale out — sell part of a winner to lock in profit while the rest runs. Note: the remaining shares are unprotected until the next cycle re-evaluates them.',
  },
  {
    key: 'add',
    label: 'Add to positions',
    description:
      'The engine may add to an existing position (pyramid into winners). Highest risk of the four — most autonomous engines exclude this. Each add is sized by the same risk rules as a new entry.',
  },
]

// Mirrors CIRCUIT_BREAKER_ERROR_THRESHOLD in backend/src/services/autoTradingEngine.js
const CIRCUIT_BREAKER_ERROR_THRESHOLD = 5

const actionVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  order_placed: 'success',
  position_added: 'success',
  position_closed: 'default',
  partial_exit: 'default',
  stop_adjusted: 'default',
  error: 'danger',
  needs_attention: 'danger',
  auto_disabled_errors: 'danger',
}

export function AutoTradingPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [symbolInput, setSymbolInput] = useState('')
  const [form, setForm] = useState<AutoTradingSettings | null>(null)

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

  const benchmarkQuery = useQuery({
    queryKey: ['auto-trading-benchmark'],
    queryFn: async () => (await api.get<{ series: BenchmarkPoint[] }>('/auto-trading/benchmark')).data.series,
  })

  useEffect(() => {
    if (settingsQuery.data && !form) setForm(settingsQuery.data)
  }, [settingsQuery.data, form])

  const saveMutation = useMutation({
    mutationFn: (payload: AutoTradingSettings) => api.put<{ settings: AutoTradingSettings }>('/auto-trading/settings', payload),
    onSuccess: (res) => {
      setForm(res.data.settings)
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
    setForm({ ...form, symbols: [...form.symbols, symbol] })
    setSymbolInput('')
  }

  const removeSymbol = (symbol: string) => {
    setForm({ ...form, symbols: form.symbols.filter((s) => s !== symbol) })
  }

  const toggleTimeframe = (tf: string) => {
    const timeframes = form.timeframes.includes(tf)
      ? form.timeframes.filter((t) => t !== tf)
      : [...form.timeframes, tf]
    setForm({ ...form, timeframes })
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
            <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Broker connection</label>
              <Select
                value={form.broker_connection_id ?? ''}
                onValueChange={(value) => setForm({ ...form, broker_connection_id: value || null })}
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
                onChange={(e) => setForm({ ...form, min_confidence: Number(e.target.value) })}
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
                onChange={(e) => setForm({ ...form, risk_per_trade_pct: Number(e.target.value) / 100 })}
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
                onChange={(e) => setForm({ ...form, max_daily_loss_pct: Number(e.target.value) / 100 })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Cooldown (minutes)</label>
              <Input
                type="number"
                min="1"
                max="1440"
                value={form.cooldown_minutes}
                onChange={(e) => setForm({ ...form, cooldown_minutes: Number(e.target.value) })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Max trades per day</label>
              <Input
                type="number"
                min="1"
                max="100"
                value={form.max_trades_per_day}
                onChange={(e) => setForm({ ...form, max_trades_per_day: Number(e.target.value) })}
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
            <label className="text-sm font-medium text-foreground">AI mode</label>
            <div className="flex flex-col gap-2">
              {AI_MODES.map((mode) => (
                <div key={mode.value} className="rounded-lg border border-border p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="ai_mode"
                      aria-label={mode.label}
                      className="mt-1 accent-primary"
                      checked={form.ai_mode === mode.value}
                      onChange={() => setForm({ ...form, ai_mode: mode.value })}
                    />
                    <span>
                      <span className="block text-sm font-medium text-foreground">{mode.label}</span>
                      <span className="block text-xs text-muted">{mode.blurb}</span>
                    </span>
                  </label>
                  <div className="mt-2 pl-7">
                    <Collapsible summary="Details & cost notes">{mode.description}</Collapsible>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Engine authority</label>
            <p className="text-xs text-muted">
              What the engine may do to open positions without asking you. Entries are governed by the enable switch above.
            </p>
            <div className="flex flex-col gap-2">
              {AUTHORITY_OPTIONS.map((opt) => (
                <div key={opt.key} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-foreground">{opt.label}</span>
                    <Switch
                      aria-label={opt.label}
                      checked={form.authority[opt.key]}
                      onCheckedChange={(checked) =>
                        setForm({ ...form, authority: { ...form.authority, [opt.key]: checked } })
                      }
                    />
                  </div>
                  <div className="mt-2">
                    <Collapsible summary="What this allows">{opt.description}</Collapsible>
                  </div>
                </div>
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

      {(benchmarkQuery.data?.length ?? 0) > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Engine vs buy-and-hold</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted">
              Daily engine equity against an equal-weight buy-and-hold of your watchlist, frozen at the first snapshot.
            </p>
            <BenchmarkChart series={benchmarkQuery.data ?? []} />
          </CardContent>
        </Card>
      )}
      {benchmarkQuery.data?.length === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Engine vs buy-and-hold</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">First benchmark snapshot recorded — the comparison chart appears after the second daily snapshot.</p>
          </CardContent>
        </Card>
      )}

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
                    <TableCell className="max-w-xs text-muted">
                      <span className="block truncate" title={run.reasoning || run.error_message || ''}>
                        {run.reasoning || run.error_message || '—'}
                      </span>
                      {run.action_detail?.decision?.timeframe_alignment && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(run.action_detail.decision.timeframe_alignment).map(([tf, bias]) => (
                            <Badge key={tf} variant={bias === 'bullish' ? 'success' : bias === 'bearish' ? 'danger' : 'muted'}>
                              {tf} {bias}
                            </Badge>
                          ))}
                        </span>
                      )}
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
