import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { MarketPage } from './MarketPage'
import { api } from '@/lib/api'
import type { MarketSnapshot, SearchResult } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/hooks/useWebSocket', () => ({
  useLivePrices: () => ({}),
}))

vi.mock('@/components/PriceChart', () => ({
  PriceChart: () => <div data-testid="price-chart" />,
}))

const snapshot: MarketSnapshot = {
  symbol: 'AAPL',
  interval: '1d',
  price: { symbol: 'AAPL', price: 190.5, change: 2.5, change_percent: 0.0132 },
  indicators: { rsi: 55.3, macd: { value: 1.2, signal: 0.8 }, trend: 'bullish' },
  recent_candles: [{ time: '2026-06-01T00:00:00.000Z', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
}

const searchResults: SearchResult[] = [{ symbol: 'MSFT', name: 'Microsoft Corp', type: 'stock' }]

function mockApi() {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/market/search') return Promise.resolve({ data: { results: searchResults } })
    if (url.startsWith('/market/snapshot/')) return Promise.resolve({ data: snapshot })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MarketPage', () => {
  test('renders default symbol snapshot, chart, and indicators', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('$190.50')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByTestId('price-chart')).toBeInTheDocument()
    expect(screen.getByText('rsi')).toBeInTheDocument()
    expect(screen.getByText('bullish')).toBeInTheDocument()
    expect(screen.getByText('value: 1.2 · signal: 0.8')).toBeInTheDocument()
  })

  test('searches and switches symbol', async () => {
    mockApi()
    renderPage()

    await screen.findByText('$190.50')
    await userEvent.type(screen.getByPlaceholderText('Search symbol or company…'), 'mic')

    expect(await screen.findByText('Microsoft Corp')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Microsoft Corp'))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'MSFT' })).toBeInTheDocument())
  })
})
