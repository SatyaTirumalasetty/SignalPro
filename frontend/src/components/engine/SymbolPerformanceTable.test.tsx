import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { SymbolPerformanceTable } from './SymbolPerformanceTable'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('SymbolPerformanceTable', () => {
  test('renders a row per symbol with realized and unrealized P&L', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { symbols: [
      { symbol: 'NVDA', trades: 7, win_rate: 0.71, realized_pnl: 412, unrealized_pnl: 120, avg_confidence: 68, last_action: 'order_placed', last_action_at: '2026-07-14T12:00:00.000Z' },
      { symbol: 'AAPL', trades: 4, win_rate: 0.5, realized_pnl: -83, unrealized_pnl: 0, avg_confidence: 59, last_action: 'skipped_low_confidence', last_action_at: '2026-07-14T12:05:00.000Z' },
    ] } })
    renderWithClient(<SymbolPerformanceTable />)
    expect(await screen.findByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('$412.00')).toBeInTheDocument()
    expect(screen.getByText('$120.00')).toBeInTheDocument()
    expect(screen.getByText('-$83.00')).toBeInTheDocument()
    expect(screen.getByText('71.0%')).toBeInTheDocument()
  })

  test('shows an empty state when there is no per-symbol data', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { symbols: [] } })
    renderWithClient(<SymbolPerformanceTable />)
    expect(await screen.findByText('No per-symbol activity yet.')).toBeInTheDocument()
  })
})
