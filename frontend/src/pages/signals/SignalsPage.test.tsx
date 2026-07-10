import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { SignalsPage } from './SignalsPage'
import { api } from '@/lib/api'
import type { Signal } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))

const signals: Signal[] = [
  {
    id: 'sig-1',
    symbol: 'AAPL',
    signal_type: 'buy',
    confidence: 0.82,
    timeframe: '1h',
    entry_price: 180,
    stop_loss: 170,
    take_profit: 200,
    predicted_price_low: 175,
    predicted_price_high: 205,
    analysis_text: 'Strong upward momentum.',
    created_at: '2026-06-01T00:00:00.000Z',
    indicators: { news: [{ id: 'n1', headline: 'AAPL beats earnings', source: 'Reuters', url: 'https://example.com/aapl' }] },
  },
  {
    id: 'sig-2',
    symbol: 'MSFT',
    signal_type: 'hold',
    confidence: 0.5,
    created_at: '2026-06-02T00:00:00.000Z',
  },
]

function mockApiGet(overrides: Record<string, unknown> = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/analysis/signals') return Promise.resolve({ data: { signals: overrides.signals ?? signals } })
    if (url === '/brokers/connections') {
      return Promise.resolve({ data: { connections: overrides.connections ?? [{ id: 'conn-1', broker_id: 'alpaca', name: 'My Alpaca', status: 'connected' }] } })
    }
    if (url === '/users/me') {
      return Promise.resolve({ data: overrides.me ?? { user: { preferences: {} } } })
    }
    if (/^\/brokers\/connections\/.+\/accounts$/.test(url)) {
      return Promise.resolve({ data: { account: overrides.account ?? { funds: { equity: 0 } } } })
    }
    if (url === '/auto-trading/settings') {
      return Promise.resolve({ data: { settings: overrides.settings ?? { risk_per_trade_pct: 0.01 } } })
    }
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SignalsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SignalsPage', () => {
  test('renders signal history with badges and an empty-state when no signals', async () => {
    mockApiGet({ signals: [] })
    renderPage()

    expect(await screen.findByText('No signals yet.')).toBeInTheDocument()
  })

  test('renders the signal table and opens the detail dialog with news', async () => {
    mockApiGet()
    renderPage()

    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()

    const detailButtons = screen.getAllByRole('button', { name: 'Details' })
    fireEvent.click(detailButtons[0])

    expect(await screen.findByText('AAPL signal')).toBeInTheDocument()
    expect(screen.getByText('Strong upward momentum.')).toBeInTheDocument()
    expect(screen.getByText('News considered')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AAPL beats earnings' })).toHaveAttribute('href', 'https://example.com/aapl')
  })

  test('shows an Execute button only for buy/sell signals and opens place order dialog', async () => {
    mockApiGet()
    renderPage()

    await screen.findByText('AAPL')
    const executeButtons = screen.getAllByRole('button', { name: 'Execute' })
    expect(executeButtons).toHaveLength(1)

    fireEvent.click(executeButtons[0])

    expect(await screen.findByDisplayValue('AAPL')).toBeInTheDocument()
    expect(screen.getAllByText('Place order').length).toBeGreaterThan(0)
  })

  test('generates a new signal from the form', async () => {
    mockApiGet()
    ;(api.post as Mock).mockResolvedValue({ data: { signal: { ...signals[0], symbol: 'TSLA' } } })
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('AAPL')
    fireEvent.change(screen.getByPlaceholderText('e.g. AAPL'), { target: { value: 'tsla' } })
    await user.click(screen.getByRole('button', { name: 'Generate signal' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/analysis/generate', { symbol: 'TSLA', timeframe: '1h' }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Signal generated for TSLA', 'success'))
  })

  test('shows an error message when generating a signal fails', async () => {
    mockApiGet()
    ;(api.post as Mock).mockRejectedValue(new Error('Rate limited'))
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('AAPL')
    fireEvent.change(screen.getByPlaceholderText('e.g. AAPL'), { target: { value: 'tsla' } })
    await user.click(screen.getByRole('button', { name: 'Generate signal' }))

    expect(await screen.findByText('Rate limited')).toBeInTheDocument()
  })

  test('Buy navigates to the armed analysis page when instant mode is off', async () => {
    mockApiGet() // instant off by default
    renderPage()

    const buy = (await screen.findAllByRole('button', { name: /^buy$/i }))[0]
    fireEvent.click(buy)

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/analyze\/[A-Z.]+\?signal=.+&arm=1$/)),
    )
  })

  test('Buy places the order immediately when instant mode is on', async () => {
    mockApiGet({
      me: { user: { preferences: { trading: { instant_orders: true } } } },
      connections: [{ id: 'conn-1', name: 'Alpaca', broker_id: 'alpaca', status: 'connected' }],
      account: { funds: { equity: 100000 } },
      settings: { risk_per_trade_pct: 0.01 },
    })
    ;(api.post as Mock).mockResolvedValue({ data: { order: { id: 'order-9' } } })
    renderPage()

    const buy = (await screen.findAllByRole('button', { name: /^buy$/i }))[0]
    fireEvent.click(buy)

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/trading/orders', expect.objectContaining({ side: 'buy', signal_id: expect.any(String) })),
    )
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('instant-flag fetch failure surfaces a toast and places no order', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/users/me') {
        return Promise.reject(new Error('Network error'))
      }
      if (url === '/analysis/signals') return Promise.resolve({ data: { signals } })
      return Promise.resolve({ data: {} })
    })
    ;(api.post as Mock).mockResolvedValue({ data: { order: { id: 'order-9' } } })
    renderPage()

    const buy = (await screen.findAllByRole('button', { name: /^buy$/i }))[0]
    fireEvent.click(buy)

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith('Network error', 'error'),
    )
    expect(api.post).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
