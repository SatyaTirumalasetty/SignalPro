import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { HealthStrip } from './HealthStrip'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('HealthStrip', () => {
  test('renders status, errors vs threshold and trades today', async () => {
    ;(api.get as Mock).mockResolvedValue({
      data: {
        health: { enabled: true, last_run_at: '2026-07-14T12:00:00.000Z', errors_24h: 1, circuit_breaker_threshold: 5, trades_today: 2 },
        performance: { return_pct: null, vs_buy_hold_pct: null, win_rate: null, trades: 0 },
        decision_breakdown: [], avg_confidence: null,
      },
    })
    renderWithClient(<HealthStrip />)
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  test('shows disabled when engine is off', async () => {
    ;(api.get as Mock).mockResolvedValue({
      data: {
        health: { enabled: false, last_run_at: null, errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 0 },
        performance: { return_pct: null, vs_buy_hold_pct: null, win_rate: null, trades: 0 },
        decision_breakdown: [], avg_confidence: null,
      },
    })
    renderWithClient(<HealthStrip />)
    await waitFor(() => expect(screen.getByText('Disabled')).toBeInTheDocument())
  })
})
