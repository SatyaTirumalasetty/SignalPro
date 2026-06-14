import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { AdminSignalsPage } from './AdminSignalsPage'
import { api } from '@/lib/api'
import type { AdminSignalOverall, AdminSignalStat } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

const overall: AdminSignalOverall = { total: 1000, avg_confidence: 0.65, total_tokens: 500000, unique_users: 42 }
const bySymbol: AdminSignalStat[] = [{ symbol: 'AAPL', signal_type: 'buy', total: 100, avg_confidence: 0.7, executed: 30 }]

function mockApi(overrides: { overall?: AdminSignalOverall; bySymbol?: AdminSignalStat[] } = {}) {
  ;(api.get as Mock).mockResolvedValue({
    data: { overall: overrides.overall ?? overall, by_symbol: overrides.bySymbol ?? bySymbol },
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminSignalsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminSignalsPage', () => {
  test('renders overall cards and by-symbol table', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('1,000')).toBeInTheDocument()
    expect(screen.getByText('65.0%')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('buy')).toBeInTheDocument()
  })

  test('shows empty state when there is no signal data', async () => {
    mockApi({ bySymbol: [] })
    renderPage()

    expect(await screen.findByText('No signal data yet.')).toBeInTheDocument()
  })
})
