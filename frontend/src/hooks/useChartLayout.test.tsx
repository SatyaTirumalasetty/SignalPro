import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { api } from '@/lib/api'
import { useChartLayout } from './useChartLayout'
import { DEFAULT_LAYOUT, type IndicatorConfig } from '@/lib/indicators/types'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  API_BASE_URL: 'http://localhost:3001',
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const newLayout: IndicatorConfig[] = [{ id: 'sma-20', kind: 'sma', params: { period: 20 }, visible: true }]

beforeEach(() => {
  vi.clearAllMocks()
  ;(api.put as Mock).mockResolvedValue({ data: {} })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useChartLayout', () => {
  test('edit made before the initial GET resolves still preserves other preference keys on save', async () => {
    vi.useFakeTimers()
    // Mount fetch (GET #1) is left pending to simulate a slow initial load.
    const initialGet = deferred<{ data: unknown }>()
    // The debounced save re-fetches fresh preferences (GET #2) before merging + PUTting.
    ;(api.get as Mock)
      .mockReturnValueOnce(initialGet.promise)
      .mockResolvedValueOnce({
        data: { user: { preferences: { auto_trading: true, chart_layout: DEFAULT_LAYOUT } } },
      })

    const { result } = renderHook(() => useChartLayout(), { wrapper })

    act(() => {
      result.current.setLayout(newLayout)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(api.put).toHaveBeenCalledTimes(1)
    expect(api.put).toHaveBeenCalledWith('/users/me', {
      preferences: expect.objectContaining({
        auto_trading: true,
        chart_layout: newLayout,
      }),
    })
  })

  test('a saved empty-array chart_layout is respected (not reverted to DEFAULT_LAYOUT)', async () => {
    ;(api.get as Mock).mockResolvedValue({
      data: { user: { preferences: { chart_layout: [] } } },
    })

    const { result } = renderHook(() => useChartLayout(), { wrapper })

    await act(async () => {
      await vi.waitFor(() => expect(result.current.isLoaded).toBe(true))
    })

    expect(result.current.layout).toEqual([])
    expect(result.current.layout).not.toEqual(DEFAULT_LAYOUT)
  })

  test('unmounting before the debounce fires results in no PUT', async () => {
    vi.useFakeTimers()
    ;(api.get as Mock).mockResolvedValue({
      data: { user: { preferences: { chart_layout: DEFAULT_LAYOUT } } },
    })

    const { result, unmount } = renderHook(() => useChartLayout(), { wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      result.current.setLayout(newLayout)
    })

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(api.put).not.toHaveBeenCalled()
  })
})
