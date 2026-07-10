import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Candle } from '@/types/api'

interface HistoryPage {
  has_more: boolean
  data: { candles: (Candle & { timestamp?: number })[]; current_price: number | null; previous_close: number | null }
}

const PAGE_BARS = 300

export const candlesKey = (symbol: string, timeframe: string) => ['candles', symbol, timeframe] as const

async function fetchPage(symbol: string, timeframe: string, before?: number): Promise<HistoryPage> {
  const params: Record<string, string | number> = { interval: timeframe, bars: PAGE_BARS }
  if (before) params.before = before
  const res = await api.get<HistoryPage>(`/market/history/${symbol}`, { params })
  return res.data
}

export function useCandles(symbol: string, timeframe: string) {
  const query = useInfiniteQuery({
    queryKey: candlesKey(symbol, timeframe),
    queryFn: ({ pageParam }) => fetchPage(symbol, timeframe, pageParam as number | undefined),
    initialPageParam: undefined as number | undefined,
    // pages are stored newest-first; the cursor is the oldest loaded timestamp
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined
      const oldest = lastPage.data.candles[0] as Candle & { timestamp?: number }
      return oldest?.timestamp ?? undefined
    },
    staleTime: 60_000,
  })

  const pages = query.data?.pages ?? []
  // pages[0] is the newest; older pages come after — prepend in reverse
  const candles = pages.slice().reverse().flatMap((p) => p.data.candles)
  const newest = pages[0]

  return {
    candles,
    currentPrice: newest?.data.current_price ?? null,
    isLoading: query.isLoading,
    hasMore: query.hasNextPage ?? false,
    loadOlder: () => { if (!query.isFetchingNextPage) void query.fetchNextPage() },
    isLoadingOlder: query.isFetchingNextPage,
  }
}

export function prefetchCandles(queryClient: QueryClient, symbol: string, timeframe = '1h') {
  void queryClient.prefetchInfiniteQuery({
    queryKey: candlesKey(symbol, timeframe),
    queryFn: () => fetchPage(symbol, timeframe),
    initialPageParam: undefined as number | undefined,
    staleTime: 60_000,
  })
}

// Merge a live tick into the forming (last) candle. Pure; returns the same
// reference when there is nothing to merge so React effects don't loop.
export function mergeLivePrice(candles: Candle[], price: number | null | undefined): Candle[] {
  if (!price || candles.length === 0) return candles
  const last = candles[candles.length - 1]
  if (last.close === price) return candles
  const updated: Candle = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  }
  return [...candles.slice(0, -1), updated]
}
