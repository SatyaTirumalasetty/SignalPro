import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { BacktestPage } from './BacktestPage'
import { api } from '@/lib/api'
import type { BacktestResult } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const result: BacktestResult = {
  summary: {
    total_trades: 2,
    win_count: 1,
    loss_count: 1,
    win_rate: 50,
    avg_win: 100,
    avg_loss: -50,
    total_return_pct: 5,
    max_drawdown_pct: -10,
    initial_equity: 100000,
    final_equity: 105000,
  },
  trades: [
    {
      entry_time: '2026-06-01T00:00:00.000Z',
      exit_time: '2026-06-02T00:00:00.000Z',
      entry_price: 100,
      exit_price: 110,
      quantity: 10,
      pnl: 100,
      exit_reason: 'take_profit',
    },
    {
      entry_time: '2026-06-03T00:00:00.000Z',
      exit_time: '2026-06-04T00:00:00.000Z',
      entry_price: 110,
      exit_price: 105,
      quantity: 10,
      pnl: -50,
      exit_reason: 'stop_loss',
    },
  ],
  equity_curve: [
    { time: '2026-06-01T00:00:00.000Z', equity: 100000 },
    { time: '2026-06-04T00:00:00.000Z', equity: 105000 },
  ],
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BacktestPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BacktestPage', () => {
  test('renders the form with default values', () => {
    renderPage()
    expect(screen.getByText('Backtest')).toBeInTheDocument()
    expect(screen.getByDisplayValue('AAPL')).toBeInTheDocument()
    expect(screen.getByDisplayValue('300')).toBeInTheDocument()
    expect(screen.getByDisplayValue('100000')).toBeInTheDocument()
  })

  test('runs a backtest and renders summary, trades, and equity curve', async () => {
    ;(api.post as Mock).mockResolvedValue({ data: result })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/backtest/run', {
        symbol: 'AAPL',
        timeframe: '1d',
        bars: 300,
        initial_equity: 100000,
      }),
    )

    expect(await screen.findByText('Total trades')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('take_profit')).toBeInTheDocument()
    expect(screen.getByText('stop_loss')).toBeInTheDocument()
  })

  test('shows an error message when the backtest fails', async () => {
    ;(api.post as Mock).mockRejectedValue(new Error('Bad symbol'))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }))

    expect(await screen.findByText('Bad symbol')).toBeInTheDocument()
  })

  test('shows a message when no trades were generated', async () => {
    ;(api.post as Mock).mockResolvedValue({
      data: { ...result, trades: [], equity_curve: [] },
    })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }))

    expect(await screen.findByText('No trades were generated for this window.')).toBeInTheDocument()
    expect(screen.getByText('No equity curve data.')).toBeInTheDocument()
  })

  test('updates symbol, timeframe, bars, and initial equity inputs', () => {
    renderPage()

    const symbolInput = screen.getByPlaceholderText('Symbol (e.g. AAPL)')
    fireEvent.change(symbolInput, { target: { value: 'tsla' } })
    expect(symbolInput).toHaveValue('tsla')

    const barsInput = screen.getByPlaceholderText('Bars')
    fireEvent.change(barsInput, { target: { value: '500' } })
    expect(barsInput).toHaveValue(500)

    const equityInput = screen.getByPlaceholderText('Initial equity')
    fireEvent.change(equityInput, { target: { value: '50000' } })
    expect(equityInput).toHaveValue(50000)
  })
})
