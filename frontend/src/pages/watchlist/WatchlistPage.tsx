import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Search, Heart } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api, getApiErrorMessage } from '@/lib/api'
import { useLivePrices } from '@/hooks/useWebSocket'
import { useToast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/format'
import { SYMBOL_NAMES, orderBySeedRank } from '@/lib/watchlist'
import { useWatchlist, useWatchlistMutation } from '@/hooks/useWatchlist'
import type { MarketPricesResponse, SearchResult } from '@/types/api'

// Day-change % is already a percent (e.g. 1.2, 0.5). Render directly — do NOT
// use formatPercent, which multiplies values ≤1 by 100.
const changePct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

export function WatchlistPage() {
  const { data: storedSymbols = [] } = useWatchlist()
  // Render (and persist) in canonical seed order so a re-added symbol returns to
  // its curated slot instead of the tail. Also heals any already-out-of-order list.
  const symbols = useMemo(() => orderBySeedRank(storedSymbols), [storedSymbols])
  const mutation = useWatchlistMutation()
  const { toast } = useToast()
  const [query, setQuery] = useState('')

  const search = useQuery({
    queryKey: ['market-search', query],
    queryFn: async () => (await api.get<{ results: SearchResult[] }>('/market/search', { params: { q: query } })).data.results,
    enabled: query.trim().length > 1,
  })

  const pricesQuery = useQuery({
    queryKey: ['watchlist-prices', symbols],
    queryFn: async () => (await api.get<MarketPricesResponse>('/market/prices', { params: { symbols: symbols.join(',') } })).data.prices,
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    // Keep the previous batch while a new query key (symbols list changed via
    // toggle) is in flight, so rows don't flash to "—" on every heart click.
    placeholderData: keepPreviousData,
  })
  const priceMap = useMemo(
    () => new Map((pricesQuery.data ?? []).map((p) => [p.symbol, p])),
    [pricesQuery.data],
  )
  const live = useLivePrices(symbols)

  const toggle = (sym: string) => {
    const base = symbols.includes(sym) ? symbols.filter((s) => s !== sym) : [...symbols, sym]
    mutation.mutate(orderBySeedRank(base), { onError: (err) => toast(getApiErrorMessage(err), 'error') })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Watchlist</h1>
        <p className="text-sm text-muted">Your personal favorites for browsing prices &amp; signals — separate from what the engine trades.</p>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input placeholder="Search symbol or company…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
        {search.data && search.data.length > 0 && query.trim().length > 1 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
            {search.data.map((result) => (
              <button
                key={result.symbol}
                onClick={() => { toggle(result.symbol); setQuery('') }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground hover:bg-primary/10 cursor-pointer"
              >
                <span><span className="font-medium">{result.symbol}</span> <span className="text-muted">{result.name}</span></span>
                <Heart size={16} className={symbols.includes(result.symbol) ? 'fill-danger text-danger' : 'text-muted'} />
              </button>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col divide-y divide-border p-0">
          {symbols.length === 0 && (
            <p className="p-4 text-sm text-muted">Your watchlist is empty. Search above and tap the heart to add a stock.</p>
          )}
          {symbols.map((sym) => {
            const p = priceMap.get(sym)
            const price = live[sym]?.price ?? p?.price
            const change = live[sym]?.change_percent ?? p?.change_percent
            return (
              <div key={sym} className="flex items-center gap-4 px-4 py-3">
                <button onClick={() => toggle(sym)} aria-label={`Remove ${sym}`} className="shrink-0">
                  <Heart size={18} className="fill-danger text-danger" />
                </button>
                {/* Row is non-interactive here: the /analyze symbol page ships in a
                    separate change, so we render the label statically rather than
                    linking to a route that doesn't exist yet. */}
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{sym}</div>
                  <div className="truncate text-xs text-muted">{SYMBOL_NAMES[sym] ?? ''}</div>
                </div>
                <div className="text-right text-sm font-medium text-foreground">{price != null ? formatCurrency(price) : '—'}</div>
                {change != null && (
                  <Badge variant={change >= 0 ? 'success' : 'danger'} className="w-20 justify-center">{changePct(change)}</Badge>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
