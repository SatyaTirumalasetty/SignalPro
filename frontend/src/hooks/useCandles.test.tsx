import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { api } from '@/lib/api'
import { useCandles, mergeLivePrice } from './useCandles'
import type { Candle } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
  API_BASE_URL: 'http://localhost:3001',
}))

function candle(i: number): Candle & { timestamp: number } {
  return { timestamp: i * 60000, time: new Date(i * 60000).toISOString(), open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => vi.clearAllMocks())

describe('useCandles', () => {
  test('fetches the first page and exposes candles + price', async () => {
    ;(api.get as Mock).mockResolvedValue({
      data: { has_more: true, data: { candles: [candle(1), candle(2)], current_price: 100.7, previous_close: 99 } },
    })
    const { result } = renderHook(() => useCandles('AAPL', '1h'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.candles).toHaveLength(2)
    expect(result.current.currentPrice).toBe(100.7)
    expect(result.current.hasMore).toBe(true)
    expect(api.get).toHaveBeenCalledWith('/market/history/AAPL', { params: { interval: '1h', bars: 300 } })
  })

  test('loadOlder prepends the previous page using the oldest timestamp as cursor', async () => {
    ;(api.get as Mock)
      .mockResolvedValueOnce({ data: { has_more: true, data: { candles: [candle(10), candle(11)], current_price: 1, previous_close: 1 } } })
      .mockResolvedValueOnce({ data: { has_more: false, data: { candles: [candle(8), candle(9)], current_price: 1, previous_close: 1 } } })
    const { result } = renderHook(() => useCandles('AAPL', '1h'), { wrapper })
    await waitFor(() => expect(result.current.candles).toHaveLength(2))
    act(() => result.current.loadOlder())
    await waitFor(() => expect(result.current.candles).toHaveLength(4))
    expect(result.current.candles[0].time).toBe(candle(8).time)
    expect(result.current.hasMore).toBe(false)
    expect((api.get as Mock).mock.calls[1][1].params.before).toBe(10 * 60000)
  })
})

describe('mergeLivePrice', () => {
  test('updates close and widens high/low of the last candle', () => {
    const merged = mergeLivePrice([candle(1), candle(2)], 103)
    expect(merged[1].close).toBe(103)
    expect(merged[1].high).toBe(103)
    expect(merged[0]).toEqual(candle(1))
  })
  test('no price -> unchanged reference', () => {
    const arr = [candle(1)]
    expect(mergeLivePrice(arr, null)).toBe(arr)
  })
})
