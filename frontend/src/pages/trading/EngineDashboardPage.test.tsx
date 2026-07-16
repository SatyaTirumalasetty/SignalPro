import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { EngineDashboardPage } from './EngineDashboardPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))
vi.mock('@/components/BenchmarkChart', () => ({ BenchmarkChart: () => <div data-testid="benchmark-chart" /> }))

const metrics = {
  health: { enabled: true, last_run_at: '2026-07-14T12:00:00.000Z', errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 2 },
  performance: { return_pct: 4.2, vs_buy_hold_pct: 1.1, win_rate: 0.61, trades: 18 },
  decision_breakdown: [{ action: 'order_placed', count: 12 }], avg_confidence: 64.5,
}

function mockGet() {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/auto-trading/metrics') return Promise.resolve({ data: metrics })
    if (url === '/auto-trading/benchmark') return Promise.resolve({ data: { series: [] } })
    if (url === '/auto-trading/symbol-performance') return Promise.resolve({ data: { symbols: [] } })
    if (url === '/auto-trading/activity') return Promise.resolve({ data: { runs: [], total: 0 } })
    if (url === '/auto-trading/calibration') return Promise.resolve({ data: { buckets: [], total_closed: 0, min_required: 10, sufficient: false } })
    if (url === '/auto-trading/guardrail-trips') return Promise.resolve({ data: { trips: [], total_runs: 0, min_required: 20, sufficient: false } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><EngineDashboardPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.clearAllMocks(); mockGet() })

describe('EngineDashboardPage', () => {
  test('renders all seven panels', async () => {
    renderPage()
    expect(await screen.findByText('Engine dashboard')).toBeInTheDocument()
    expect(screen.getByText('Trades today')).toBeInTheDocument() // health strip
    expect(await screen.findByText('Performance vs buy-and-hold')).toBeInTheDocument()
    expect(screen.getByText('Decision breakdown')).toBeInTheDocument()
    expect(screen.getByText('Per-symbol performance')).toBeInTheDocument()
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('Confidence calibration')).toBeInTheDocument()
    expect(screen.getByText('Guardrail trips')).toBeInTheDocument()
  })

  test('has a link back to engine settings', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'Settings' })
    expect(link).toHaveAttribute('href', '/auto-trading')
  })
})
