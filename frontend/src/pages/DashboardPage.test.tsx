import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { DashboardPage } from './DashboardPage'
import { api } from '@/lib/api'
import type { PortfolioSummary, Order, Signal } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'trader@example.com', full_name: 'Trader Joe' } }),
}))

vi.mock('@/hooks/useWebSocket', () => ({
  useLivePrices: (symbols: string[]) =>
    Object.fromEntries(symbols.map((s) => [s, { price: 123.45, change_percent: 1.5 }])),
}))

const portfolio: PortfolioSummary = {
  positions: [{ symbol: 'AAPL', position_type: 'long', total_quantity: 10, avg_entry: 100, total_pnl: 50, position_count: 1 }],
  summary: { open_positions: 1, closed_positions: 2, realized_pnl: 100, unrealized_pnl: -25 },
}

const orders: Order[] = [
  { id: 'o1', symbol: 'AAPL', side: 'buy', quantity: 10, status: 'filled', order_type: 'market', created_at: '2026-06-01T00:00:00.000Z' } as Order,
]

const signals: Signal[] = [
  { id: 's1', symbol: 'AAPL', signal_type: 'buy', confidence: 0.7, created_at: '2026-06-01T00:00:00.000Z' },
]

function mockApiGet(overrides: Record<string, unknown> = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/trading/portfolio') return Promise.resolve({ data: overrides.portfolio ?? portfolio })
    if (url === '/trading/orders') return Promise.resolve({ data: { orders: overrides.orders ?? orders } })
    if (url === '/analysis/signals') return Promise.resolve({ data: { signals: overrides.signals ?? signals } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardPage', () => {
  test('renders summary cards, live prices, recent orders, and latest signals', async () => {
    mockApiGet()
    renderPage()

    expect(screen.getByText('Welcome back, Trader Joe')).toBeInTheDocument()
    expect(await screen.findByText('Live prices')).toBeInTheDocument()
    expect(screen.getByText('$123.45')).toBeInTheDocument()
    expect(await screen.findByText('BUY')).toBeInTheDocument()
    expect(screen.getByText('filled')).toBeInTheDocument()
  })

  test('shows empty states when there are no orders or signals', async () => {
    mockApiGet({ orders: [], signals: [], portfolio: { positions: [], summary: { open_positions: 0, closed_positions: 0, realized_pnl: 0, unrealized_pnl: 0 } } })
    renderPage()

    expect(await screen.findByText('No orders yet')).toBeInTheDocument()
    expect(screen.getByText('No signals yet')).toBeInTheDocument()
  })
})
