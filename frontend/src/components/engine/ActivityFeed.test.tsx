import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { ActivityFeed } from './ActivityFeed'
import { api } from '@/lib/api'
import type { AutoTradingRun } from '@/types/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const run: AutoTradingRun = {
  id: 'r1', symbol: 'NVDA', timeframe: '15m+1h+4h', decision: 'buy', confidence: 72,
  action: 'order_placed', signal_id: null, order_id: 'o1', reasoning: 'Momentum aligned', error_message: null,
  action_detail: { decision: { timeframe_alignment: { '1h': 'bullish', '4h': 'bullish' } } }, created_at: '2026-07-14T12:00:00.000Z',
}

beforeEach(() => vi.clearAllMocks())

describe('ActivityFeed', () => {
  test('renders rows and expands a row to show detail on click', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { runs: [run], total: 1 } })
    renderWithClient(<ActivityFeed />)
    const row = await screen.findByText('NVDA')
    // detail hidden initially
    expect(screen.queryByText('1h bullish')).not.toBeInTheDocument()
    fireEvent.click(row)
    expect(await screen.findByText('1h bullish')).toBeInTheDocument()
    expect(screen.getByText('Momentum aligned')).toBeInTheDocument()
  })

  test('typing a symbol filter refetches with the symbol param', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { runs: [run], total: 1 } })
    renderWithClient(<ActivityFeed />)
    await screen.findByText('NVDA')
    fireEvent.change(screen.getByPlaceholderText('Filter symbol'), { target: { value: 'AAPL' } })
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/auto-trading/activity', expect.objectContaining({ params: expect.objectContaining({ symbol: 'AAPL' }) })),
    )
  })
})
