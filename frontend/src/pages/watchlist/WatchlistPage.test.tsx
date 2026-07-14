import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { WatchlistPage } from './WatchlistPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), put: vi.fn() } }))
vi.mock('@/hooks/useWebSocket', () => ({ useLivePrices: () => ({}) }))

function mockGet(symbols = ['AAPL', 'MSFT']) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/watchlist') return Promise.resolve({ data: { symbols } })
    if (url === '/market/prices') return Promise.resolve({ data: { prices: [
      { symbol: 'AAPL', price: 205.05, change_percent: 1.2 },
      { symbol: 'MSFT', price: 410.1, change_percent: -0.3 },
    ] } })
    if (url === '/market/search') return Promise.resolve({ data: { results: [] } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><WatchlistPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.clearAllMocks() })

describe('WatchlistPage', () => {
  test('renders a row per watchlist symbol with price and day change', async () => {
    mockGet()
    renderPage()
    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple')).toBeInTheDocument()
    expect(screen.getByText('$205.05')).toBeInTheDocument()
    expect(screen.getByText('+1.20%')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.getByText('-0.30%')).toBeInTheDocument()
  })
})
