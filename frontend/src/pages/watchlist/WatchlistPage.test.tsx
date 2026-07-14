import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { WatchlistPage } from './WatchlistPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))
vi.mock('@/hooks/useWebSocket', () => ({ useLivePrices: () => ({}) }))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: toastFn }) }))

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
    // Prices resolve one tick after symbols, so await this assertion too.
    expect(await screen.findByText('$205.05')).toBeInTheDocument()
    expect(screen.getByText('+1.20%')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.getByText('-0.30%')).toBeInTheDocument()
  })

  test('un-hearting a row PUTs the reduced list', async () => {
    mockGet(['AAPL', 'MSFT'])
    ;(api.put as Mock).mockResolvedValue({ data: { symbols: ['MSFT'] } })
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('AAPL')
    await user.click(screen.getByLabelText('Remove AAPL'))
    expect(api.put).toHaveBeenCalledWith('/watchlist', { symbols: ['MSFT'] })
  })

  test('searching and hearting a result PUTs the appended list', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/watchlist') return Promise.resolve({ data: { symbols: ['AAPL'] } })
      if (url === '/market/prices') return Promise.resolve({ data: { prices: [{ symbol: 'AAPL', price: 205.05, change_percent: 1.2 }] } })
      if (url === '/market/search') return Promise.resolve({ data: { results: [{ symbol: 'NVDA', name: 'NVIDIA', type: 'stock' }] } })
      return Promise.resolve({ data: {} })
    })
    ;(api.put as Mock).mockResolvedValue({ data: { symbols: ['AAPL', 'NVDA'] } })
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('AAPL')
    await user.type(screen.getByPlaceholderText('Search symbol or company…'), 'nvi')
    await user.click(await screen.findByText('NVIDIA'))
    expect(api.put).toHaveBeenCalledWith('/watchlist', { symbols: ['AAPL', 'NVDA'] })
  })

  test('shows the empty state when the list is empty', async () => {
    mockGet([])
    renderPage()
    expect(await screen.findByText(/your watchlist is empty/i)).toBeInTheDocument()
  })

  test('a failed toggle rolls back and shows an error toast', async () => {
    mockGet(['AAPL', 'MSFT'])
    ;(api.put as Mock).mockRejectedValue(new Error('network'))
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('AAPL')
    await user.click(screen.getByLabelText('Remove AAPL'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(expect.any(String), 'error'))
    // rolled back: AAPL still present
    expect(screen.getByText('AAPL')).toBeInTheDocument()
  })
})
