import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { SignalPerformancePage } from './SignalPerformancePage'
import { api } from '@/lib/api'
import type { SignalPerformance } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

const performance: SignalPerformance = {
  overall: { total_signals: 120, executed: 80, avg_confidence: 0.72, total_tokens_used: 45000 },
  by_type: [{ signal_type: 'buy', total: 60, executed: 40, avg_confidence: 0.75, avg_pnl_percent: 0.05 }],
}

function mockApi(data: SignalPerformance = performance) {
  ;(api.get as Mock).mockResolvedValue({ data })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SignalPerformancePage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SignalPerformancePage', () => {
  test('renders overall stats and by-type table', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('120')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('72.0%')).toBeInTheDocument()
    expect(screen.getByText('buy')).toBeInTheDocument()
    expect(screen.getByText('5.0%')).toBeInTheDocument()
  })

  test('shows empty state when there is no signal data', async () => {
    mockApi({ overall: { total_signals: 0, executed: 0, avg_confidence: 0, total_tokens_used: 0 }, by_type: [] })
    renderPage()

    expect(await screen.findByText('No signal data yet.')).toBeInTheDocument()
  })
})
