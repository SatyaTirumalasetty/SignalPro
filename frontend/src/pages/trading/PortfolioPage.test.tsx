import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { PortfolioPage } from './PortfolioPage'
import { api } from '@/lib/api'
import type { PortfolioSummary } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

const portfolio: PortfolioSummary = {
  positions: [{ symbol: 'AAPL', position_type: 'long', total_quantity: 10, avg_entry: 150, total_pnl: 50, position_count: 1 }],
  summary: { open_positions: 1, closed_positions: 2, realized_pnl: 100, unrealized_pnl: -25 },
}

function mockApi(data: PortfolioSummary = portfolio) {
  ;(api.get as Mock).mockResolvedValue({ data })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PortfolioPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PortfolioPage', () => {
  test('renders summary cards and holdings table', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getAllByText('1')).toHaveLength(2)
    expect(screen.getByText('$150.00')).toBeInTheDocument()
    expect(screen.getByText('long')).toBeInTheDocument()
    expect(screen.getByText('$50.00')).toBeInTheDocument()
  })

  test('shows empty state when there are no holdings', async () => {
    mockApi({ positions: [], summary: { open_positions: 0, closed_positions: 0, realized_pnl: 0, unrealized_pnl: 0 } })
    renderPage()

    expect(await screen.findByText('No holdings yet.')).toBeInTheDocument()
  })
})
