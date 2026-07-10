import { useCallback, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnalysisChart } from '@/components/analysis/AnalysisChart'
import { IndicatorManager } from '@/components/analysis/IndicatorManager'
import { TradeTicket } from '@/components/analysis/TradeTicket'
import { useCandles, mergeLivePrice } from '@/hooks/useCandles'
import { useChartLayout } from '@/hooks/useChartLayout'
import { useLivePrices } from '@/hooks/useWebSocket'
import { api } from '@/lib/api'
import { formatDate, signalBadgeVariant } from '@/lib/format'
import type { Signal } from '@/types/api'

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d']

interface ApiErrorLike { response?: { status?: number } }

export function SymbolAnalysisPage() {
  const { symbol = '' } = useParams()
  const [searchParams] = useSearchParams()
  const signalId = searchParams.get('signal')
  const armed = searchParams.get('arm') === '1'
  const [timeframe, setTimeframe] = useState(searchParams.get('tf') || '1h')
  const [logScale, setLogScale] = useState(false)
  const [showSignal, setShowSignal] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)

  const { candles, currentPrice, isLoading, hasMore, loadOlder } = useCandles(symbol, timeframe)
  const symbols = useMemo(() => [symbol], [symbol])
  const livePrices = useLivePrices(symbols)
  const liveCandles = useMemo(
    () => mergeLivePrice(candles, livePrices[symbol]?.price ?? null),
    [candles, livePrices, symbol],
  )
  const onReachOldest = useCallback(() => {
    if (hasMore) loadOlder()
  }, [hasMore, loadOlder])

  const signalQuery = useQuery({
    queryKey: ['analysis-signal', symbol, signalId],
    queryFn: async () => {
      try {
        const signal = signalId
          ? (await api.get<{ signal: Signal }>(`/analysis/signals/${signalId}`)).data.signal
          : (await api.get<{ signal: Signal }>(`/analysis/latest/${symbol}`)).data.signal
        return { signal, fetchedAt: Date.now() }
      } catch (err) {
        if ((err as ApiErrorLike)?.response?.status === 404) return { signal: null, fetchedAt: Date.now() }
        throw err
      }
    },
    retry: false,
  })
  const signal = signalQuery.data?.signal ?? null
  const fetchedAt = signalQuery.data?.fetchedAt ?? 0
  const expired = signal?.expires_at ? new Date(signal.expires_at).getTime() < fetchedAt : false

  const { layout, setLayout } = useChartLayout()

  return (
    <div className={`flex flex-col gap-4 ${fullscreen ? 'fixed inset-0 z-50 bg-background p-4' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-foreground">
          {symbol} <span className="text-sm font-normal text-muted">{currentPrice != null ? `$${currentPrice}` : ''}</span>
        </h1>
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                timeframe === tf ? 'border-primary bg-primary/20 text-primary' : 'border-border bg-card text-muted hover:text-foreground'
              }`}
            >
              {tf}
            </button>
          ))}
          <button type="button" onClick={() => setLogScale((v) => !v)} className="ml-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted hover:text-foreground">
            {logScale ? 'log' : 'lin'}
          </button>
          <button type="button" onClick={() => setFullscreen((v) => !v)} className="rounded-full border border-border bg-card px-3 py-1 text-sm text-muted hover:text-foreground">
            {fullscreen ? 'exit' : 'full'}
          </button>
        </div>
      </div>

      {expired && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-500">
          Signal expired — prices may be stale.
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <IndicatorManager value={layout} onChange={setLayout} />
          {isLoading ? (
            <p className="text-sm text-muted">Loading chart…</p>
          ) : (
            <AnalysisChart
              candles={liveCandles}
              indicators={layout}
              signal={signal}
              showSignal={showSignal}
              logScale={logScale}
              onReachOldest={onReachOldest}
            />
          )}
        </div>

        <div className="flex w-full flex-col gap-4 lg:w-96">
          <Card>
            <CardHeader>
              <CardTitle>AI signal</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {signal ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant={signalBadgeVariant(signal.signal_type)}>{signal.signal_type}</Badge>
                    <span className="text-foreground">{signal.confidence}% confidence</span>
                    <button
                      type="button"
                      onClick={() => setShowSignal((v) => !v)}
                      className="ml-auto text-xs text-muted hover:text-foreground"
                    >
                      {showSignal ? 'hide on chart' : 'show on chart'}
                    </button>
                  </div>
                  <p className="text-muted">{signal.analysis_text}</p>
                  <p className="text-xs text-muted">
                    Entry {signal.entry_price ?? '—'} · Stop {signal.stop_loss ?? '—'} · Target {signal.take_profit ?? '—'}
                  </p>
                  {signal.created_at && <p className="text-xs text-muted">Generated {formatDate(signal.created_at)}</p>}
                </>
              ) : (
                <p className="text-muted">No AI signal for {symbol} yet. Generate one from the Signals page, or trade manually below.</p>
              )}
            </CardContent>
          </Card>

          <TradeTicket symbol={symbol} signal={signal} currentPrice={currentPrice} armed={armed} />
        </div>
      </div>
    </div>
  )
}
