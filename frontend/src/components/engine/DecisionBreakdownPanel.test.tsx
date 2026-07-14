import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { DecisionBreakdownPanel } from './DecisionBreakdownPanel'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('DecisionBreakdownPanel', () => {
  test('renders a labelled bar per action and the average confidence', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: {
      health: { enabled: true, last_run_at: null, errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 0 },
      performance: { return_pct: null, vs_buy_hold_pct: null, win_rate: null, trades: 0 },
      decision_breakdown: [ { action: 'order_placed', count: 12 }, { action: 'skipped_low_confidence', count: 30 } ],
      avg_confidence: 64.5,
    } })
    renderWithClient(<DecisionBreakdownPanel />)
    expect(await screen.findByText('order_placed')).toBeInTheDocument()
    expect(screen.getByText('skipped_low_confidence')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText(/Avg confidence/)).toHaveTextContent('65%')
  })

  test('shows an empty state when there are no runs', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: {
      health: { enabled: false, last_run_at: null, errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 0 },
      performance: { return_pct: null, vs_buy_hold_pct: null, win_rate: null, trades: 0 },
      decision_breakdown: [], avg_confidence: null,
    } })
    renderWithClient(<DecisionBreakdownPanel />)
    expect(await screen.findByText('No decisions recorded yet.')).toBeInTheDocument()
  })
})
