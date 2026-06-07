import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PriceChart } from '@/components/PriceChart'
import { api } from '@/lib/api'
import { useLivePrices } from '@/hooks/useWebSocket'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format'
import type { MarketSnapshot, SearchResult } from '@/types/api'

export function MarketPage() {
  const [query, setQuery] = useState('')
  const [symbol, setSymbol] = useState('AAPL')

  const searchQuery = useQuery({
    queryKey: ['market-search', query],
    queryFn: async () => (await api.get<{ results: SearchResult[] }>('/market/search', { params: { q: query } })).data.results,
    enabled: query.trim().length > 1,
  })

  const snapshotQuery = useQuery({
    queryKey: ['market-snapshot', symbol],
    queryFn: async () => (await api.get<MarketSnapshot>(`/market/snapshot/${symbol}`)).data,
    enabled: !!symbol,
    refetchInterval: 60_000,
  })

  const liveSymbols = useMemo(() => (symbol ? [symbol] : []), [symbol])
  const livePrices = useLivePrices(liveSymbols)
  const live = livePrices[symbol]

  const snapshot = snapshotQuery.data
  const price = live?.price ?? snapshot?.price.price
  const changePercent = live?.change_percent ?? snapshot?.price.change_percent

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Market</h1>
        <p className="text-sm text-muted">Search symbols and view live prices &amp; indicators</p>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input
          placeholder="Search symbol or company…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
        {searchQuery.data && searchQuery.data.length > 0 && query.trim().length > 1 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
            {searchQuery.data.map((result) => (
              <button
                key={result.symbol}
                onClick={() => {
                  setSymbol(result.symbol)
                  setQuery('')
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground hover:bg-primary/10 cursor-pointer"
              >
                <span className="font-medium">{result.symbol}</span>
                <span className="text-muted">{result.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>{symbol}</CardTitle>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-foreground">{formatCurrency(price)}</span>
              {changePercent !== undefined && changePercent !== null && (
                <Badge variant={changePercent >= 0 ? 'success' : 'danger'}>
                  {changePercent >= 0 ? '+' : ''}
                  {formatPercent(changePercent)}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {snapshotQuery.isLoading && <p className="text-sm text-muted">Loading chart…</p>}
          {snapshot && snapshot.recent_candles?.length > 0 && <PriceChart candles={snapshot.recent_candles} />}
        </CardContent>
      </Card>

      {snapshot?.indicators && (
        <Card>
          <CardHeader>
            <CardTitle>Indicators</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(snapshot.indicators).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border p-3">
                  <div className="text-xs uppercase text-muted">{key.replace(/_/g, ' ')}</div>
                  <div className="mt-1 text-sm text-foreground">
                    {typeof value === 'number'
                      ? formatNumber(value)
                      : value && typeof value === 'object'
                        ? Object.entries(value as Record<string, unknown>)
                            .map(([k, v]) => `${k}: ${typeof v === 'number' ? formatNumber(v) : v}`)
                            .join(' · ')
                        : String(value)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
