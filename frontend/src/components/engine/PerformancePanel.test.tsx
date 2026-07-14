import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { PerformancePanel } from './PerformancePanel'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))
vi.mock('@/components/BenchmarkChart', () => ({ BenchmarkChart: () => <div data-testid="benchmark-chart" /> }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const metrics = {
  health: { enabled: true, last_run_at: null, errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 0 },
  performance: { return_pct: 4.2, vs_buy_hold_pct: 1.1, win_rate: 0.61, trades: 18 },
  decision_breakdown: [], avg_confidence: null,
}

beforeEach(() => vi.clearAllMocks())

describe('PerformancePanel', () => {
  test('renders KPI tiles and the chart when 2+ snapshots exist', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/auto-trading/metrics') return Promise.resolve({ data: metrics })
      if (url === '/auto-trading/benchmark') return Promise.resolve({ data: { series: [
        { date: '2026-07-13', engine_equity: 100000, watchlist_value: 100000 },
        { date: '2026-07-14', engine_equity: 104200, watchlist_value: 103100 },
      ] } })
      return Promise.resolve({ data: {} })
    })
    renderWithClient(<PerformancePanel />)
    expect(await screen.findByText('4.20%')).toBeInTheDocument() // return_pct
    expect(screen.getByText('61.0%')).toBeInTheDocument() // win_rate
    expect(screen.getByText('18')).toBeInTheDocument() // trades
    expect(screen.getByTestId('benchmark-chart')).toBeInTheDocument()
  })

  test('shows the pending-snapshot note with fewer than 2 snapshots', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/auto-trading/metrics') return Promise.resolve({ data: { ...metrics, performance: { ...metrics.performance, return_pct: null, vs_buy_hold_pct: null } } })
      if (url === '/auto-trading/benchmark') return Promise.resolve({ data: { series: [] } })
      return Promise.resolve({ data: {} })
    })
    renderWithClient(<PerformancePanel />)
    expect(await screen.findByText(/appears after the second daily snapshot/i)).toBeInTheDocument()
  })
})
