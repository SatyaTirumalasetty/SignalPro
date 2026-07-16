import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { SymbolAnalysisPage } from './SymbolAnalysisPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  API_BASE_URL: 'http://localhost:3001',
  getApiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error'),
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/hooks/useWebSocket', () => ({ useLivePrices: () => ({}) }))
vi.mock('@/components/analysis/AnalysisChart', () => ({
  AnalysisChart: (props: { candles: unknown[]; signal?: { id?: string } | null }) => (
    <div data-testid="analysis-chart" data-signal={props.signal?.id ?? ''} data-count={props.candles.length} />
  ),
}))

const SIGNAL = {
  id: 'sig-1', symbol: 'AAPL', signal_type: 'buy', confidence: 82,
  entry_price: 150, stop_loss: 145, take_profit: 160,
  analysis_text: 'Momentum breakout with rising volume',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
}

function mockApi({ latestSignal = SIGNAL, expired = false }: { latestSignal?: typeof SIGNAL | null; expired?: boolean } = {}) {
  const sig = latestSignal && expired ? { ...latestSignal, expires_at: new Date(Date.now() - 1000).toISOString() } : latestSignal
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url.startsWith('/market/history/')) {
      return Promise.resolve({ data: { has_more: false, data: { candles: [{ time: new Date().toISOString(), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }], current_price: 150.2, previous_close: 149 } } })
    }
    if (url === '/analysis/latest/AAPL') {
      return sig ? Promise.resolve({ data: { symbol: 'AAPL', signal: sig } }) : Promise.reject(Object.assign(new Error('not found'), { response: { status: 404 } }))
    }
    if (url === '/analysis/signals/sig-1') return Promise.resolve({ data: { signal: sig } })
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections: [] } })
    if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings: { risk_per_trade_pct: 0.01 } } })
    if (url === '/users/me') return Promise.resolve({ data: { user: { preferences: {} } } })
    return Promise.resolve({ data: {} })
  })
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/analyze/:symbol" element={<SymbolAnalysisPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('SymbolAnalysisPage', () => {
  test('renders chart, signal summary and ticket from the latest signal', async () => {
    mockApi()
    renderAt('/analyze/AAPL')
    expect(await screen.findByTestId('analysis-chart')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('analysis-chart')).toHaveAttribute('data-signal', 'sig-1'))
    expect(screen.getByText(/momentum breakout/i)).toBeInTheDocument()
    expect(screen.getByText(/82/)).toBeInTheDocument()
    expect(screen.getByText(/Trade AAPL/i)).toBeInTheDocument()
  })

  test('timeframe tab switch refetches history with the new interval', async () => {
    mockApi()
    renderAt('/analyze/AAPL')
    await screen.findByTestId('analysis-chart')
    fireEvent.click(screen.getByRole('button', { name: '15m' }))
    await waitFor(() =>
      expect((api.get as Mock).mock.calls.some(([url, cfg]) => url === '/market/history/AAPL' && cfg?.params?.interval === '15m')).toBe(true),
    )
  })

  test('no signal: chart renders, summary says no signal', async () => {
    mockApi({ latestSignal: null })
    renderAt('/analyze/AAPL')
    expect(await screen.findByTestId('analysis-chart')).toBeInTheDocument()
    expect(screen.getByText(/no ai signal/i)).toBeInTheDocument()
  })

  test('expired signal shows the stale banner', async () => {
    mockApi({ expired: true })
    renderAt('/analyze/AAPL')
    expect(await screen.findByText(/signal expired/i)).toBeInTheDocument()
  })
})
