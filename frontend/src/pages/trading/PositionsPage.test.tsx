import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { PositionsPage } from './PositionsPage'
import { api } from '@/lib/api'
import type { Position } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const openPositions: Position[] = [
  { id: 'p1', symbol: 'AAPL', position_type: 'long', quantity: 10, entry_price: 100, current_price: 110, pnl: 100, pnl_percent: 0.1, opened_at: '2026-06-01T00:00:00.000Z' },
]
const closedPositions: Position[] = [
  { id: 'p2', symbol: 'TSLA', position_type: 'short', quantity: 5, entry_price: 200, current_price: 190, pnl: 50, pnl_percent: 0.05, opened_at: '2026-05-01T00:00:00.000Z' },
]

function mockApi() {
  ;(api.get as Mock).mockImplementation((_url: string, config: { params?: { status: string } }) => {
    if (config?.params?.status === 'closed') return Promise.resolve({ data: { positions: closedPositions } })
    return Promise.resolve({ data: { positions: openPositions } })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PositionsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PositionsPage', () => {
  test('renders open positions by default', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Open positions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  test('switches to closed positions and hides close action', async () => {
    mockApi()
    renderPage()

    await screen.findByText('AAPL')
    await userEvent.click(screen.getByRole('tab', { name: 'Closed' }))

    expect(await screen.findByText('TSLA')).toBeInTheDocument()
    expect(screen.getByText('Closed positions')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  test('closes a position', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/trading/positions/p1/close'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Position closed', 'success'))
  })

  test('shows empty state when there are no positions', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { positions: [] } })
    renderPage()

    expect(await screen.findByText('No open positions.')).toBeInTheDocument()
  })
})
