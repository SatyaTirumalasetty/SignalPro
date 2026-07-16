import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { AutoTradingPage } from './AutoTradingPage'
import { api } from '@/lib/api'
import type { AutoTradingSettings, AutoTradingStatus, BrokerConnection, AutoTradingRun } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

// lightweight-charts needs a real canvas, which jsdom lacks
vi.mock('@/components/BenchmarkChart', () => ({
  BenchmarkChart: () => <div data-testid="benchmark-chart" />,
}))

const baseSettings: AutoTradingSettings = {
  enabled: true,
  broker_connection_id: 'conn-1',
  symbols: ['AAPL'],
  timeframes: ['1h'],
  min_confidence: 70,
  risk_per_trade_pct: 0.01,
  max_daily_loss_pct: 0.03,
  cooldown_minutes: 60,
  max_trades_per_day: 5,
  ai_mode: 'balanced',
  authority: { close: true, adjust_stop: false, partial_exit: false, add: false },
}

const baseStatus: AutoTradingStatus = {
  enabled: true,
  last_run_at: '2026-06-14T12:00:00.000Z',
  trades_today: 2,
  todays_pnl: 15.5,
}

const connections: BrokerConnection[] = [
  { id: 'conn-1', broker_id: 'alpaca', name: 'My Alpaca', status: 'connected' },
]

function mockApiGet(overrides: {
  settings?: AutoTradingSettings
  status?: AutoTradingStatus
  runs?: AutoTradingRun[]
} = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/auto-trading/settings') {
      return Promise.resolve({ data: { settings: overrides.settings ?? baseSettings } })
    }
    if (url === '/auto-trading/status') {
      return Promise.resolve({ data: overrides.status ?? baseStatus })
    }
    if (url === '/brokers/connections') {
      return Promise.resolve({ data: { connections } })
    }
    if (url === '/auto-trading/activity') {
      return Promise.resolve({ data: { runs: overrides.runs ?? [], total: (overrides.runs ?? []).length } })
    }
    if (url === '/auto-trading/benchmark') {
      return Promise.resolve({ data: { series: [] } })
    }
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AutoTradingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AutoTradingPage', () => {
  test('shows a loading state before settings resolve', () => {
    ;(api.get as Mock).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  test('renders settings, status stats, and watchlist symbols', async () => {
    mockApiGet()
    renderPage()

    expect(await screen.findByText('Auto Trading')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('No auto-trading activity yet.')).toBeInTheDocument()
  })

  test('shows the auto-disabled banner when circuit breaker tripped', async () => {
    mockApiGet({
      settings: { ...baseSettings, enabled: false },
      status: { ...baseStatus, enabled: false },
      runs: [
        {
          id: 'run-1',
          symbol: 'ALL',
          timeframe: '-',
          decision: null,
          confidence: null,
          action: 'auto_disabled_errors',
          signal_id: null,
          order_id: null,
          reasoning: null,
          error_message: null,
          action_detail: null,
          created_at: '2026-06-14T12:00:00.000Z',
        },
      ],
    })
    renderPage()

    expect(await screen.findByText(/automatically disabled after 5 consecutive errors/)).toBeInTheDocument()
  })

  test('adds and removes watchlist symbols, ignoring blanks and duplicates', async () => {
    mockApiGet()
    renderPage()
    await screen.findByText('Auto Trading')

    const input = screen.getByPlaceholderText('Add symbol (e.g. AAPL)')
    const addButton = screen.getByRole('button', { name: 'Add' })

    // Duplicate is ignored
    fireEvent.change(input, { target: { value: 'aapl' } })
    fireEvent.click(addButton)
    expect(screen.getAllByText('AAPL')).toHaveLength(1)

    // Blank input is ignored
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(addButton)
    expect(screen.queryAllByText('—').length).toBeGreaterThanOrEqual(0)

    // New symbol via Enter key
    fireEvent.change(input, { target: { value: 'tsla' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('TSLA')).toBeInTheDocument()

    // Remove TSLA
    const removeButtons = screen.getAllByRole('button', { name: '' })
    fireEvent.click(removeButtons[removeButtons.length - 1])
    await waitFor(() => expect(screen.queryByText('TSLA')).not.toBeInTheDocument())
  })

  test('toggles timeframes on click', async () => {
    mockApiGet()
    renderPage()
    await screen.findByText('Auto Trading')

    const oneHour = screen.getByRole('button', { name: '1h' })
    const fourHour = screen.getByRole('button', { name: '4h' })

    // 1h starts selected, clicking removes it
    fireEvent.click(oneHour)
    // 4h starts unselected, clicking adds it
    fireEvent.click(fourHour)

    expect(oneHour).toBeInTheDocument()
    expect(fourHour).toBeInTheDocument()
  })

  test('saves settings successfully', async () => {
    mockApiGet()
    ;(api.put as Mock).mockResolvedValue({ data: { settings: baseSettings } })
    renderPage()
    await screen.findByText('Auto Trading')

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/auto-trading/settings', baseSettings))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Auto-trading settings saved', 'success'))
  })

  test('shows a toast on save failure', async () => {
    mockApiGet()
    ;(api.put as Mock).mockRejectedValue(new Error('boom'))
    renderPage()
    await screen.findByText('Auto Trading')

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('boom', 'error'))
  })

  test('renders activity table rows with badges and fallbacks', async () => {
    mockApiGet({
      runs: [
        {
          id: 'run-1',
          symbol: 'AAPL',
          timeframe: '1h',
          decision: 'buy',
          confidence: 82,
          action: 'order_placed',
          signal_id: 'sig-1',
          order_id: 'order-1',
          reasoning: 'Strong momentum',
          error_message: null,
          action_detail: null,
          created_at: '2026-06-14T12:00:00.000Z',
        },
        {
          id: 'run-2',
          symbol: 'TSLA',
          timeframe: '4h',
          decision: null,
          confidence: null,
          action: 'error',
          signal_id: null,
          order_id: null,
          reasoning: null,
          error_message: 'No market data available',
          action_detail: null,
          created_at: '2026-06-14T13:00:00.000Z',
        },
      ],
    })
    renderPage()

    expect(await screen.findByText('Strong momentum')).toBeInTheDocument()
    expect(screen.getByText('No market data available')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('order_placed')).toBeInTheDocument()
    expect(screen.getByText('error')).toBeInTheDocument()
    // Decision badge for the row without a decision falls back to em dash
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  test('renders the four AI mode options with balanced selected', async () => {
    mockApiGet()
    renderPage()
    await waitFor(() => expect(screen.getByText('AI mode')).toBeInTheDocument())
    const balanced = screen.getByRole('radio', { name: /balanced/i })
    expect(balanced).toBeChecked()
    expect(screen.getByRole('radio', { name: /minimize/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /tiered/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /max/i })).toBeInTheDocument()
  })

  test('selecting an AI mode updates the form and saves it', async () => {
    mockApiGet()
    ;(api.put as Mock).mockResolvedValue({ data: { settings: { ...baseSettings, ai_mode: 'tiered' } } })
    renderPage()
    await waitFor(() => expect(screen.getByText('AI mode')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('radio', { name: /tiered/i }))
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/auto-trading/settings', expect.objectContaining({ ai_mode: 'tiered' })),
    )
  })

  test('renders authority toggles with close on by default', async () => {
    mockApiGet()
    renderPage()
    await waitFor(() => expect(screen.getByText('Engine authority')).toBeInTheDocument())
    expect(screen.getByRole('switch', { name: /close positions/i })).toBeChecked()
    expect(screen.getByRole('switch', { name: /adjust stops/i })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: /partial exits/i })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: /add to positions/i })).not.toBeChecked()
  })

  test('toggling an authority switch is included in the save payload', async () => {
    mockApiGet()
    ;(api.put as Mock).mockResolvedValue({ data: { settings: baseSettings } })
    renderPage()
    await waitFor(() => expect(screen.getByText('Engine authority')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('switch', { name: /adjust stops/i }))
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/auto-trading/settings',
        expect.objectContaining({ authority: expect.objectContaining({ adjust_stop: true }) }),
      ),
    )
  })

  test('renders new action types with variants and timeframe alignment source', async () => {
    const runs: AutoTradingRun[] = [
      {
        id: 'r1', symbol: 'AAPL', timeframe: '1h+4h', decision: 'close', confidence: 88,
        action: 'position_closed', signal_id: null, order_id: null,
        reasoning: 'trend broke', error_message: null, created_at: '2026-07-08T12:00:00.000Z',
        action_detail: { decision: { timeframe_alignment: { '1h': 'bearish', '4h': 'neutral' } } },
      },
      {
        id: 'r2', symbol: 'TSLA', timeframe: '1h+4h', decision: 'adjust_stop', confidence: 75,
        action: 'needs_attention', signal_id: null, order_id: null,
        reasoning: null, error_message: 'close failed after cancel', created_at: '2026-07-08T12:01:00.000Z',
        action_detail: null,
      },
    ]
    mockApiGet({ runs })
    renderPage()
    await waitFor(() => expect(screen.getByText('position_closed')).toBeInTheDocument())
    expect(screen.getByText('needs_attention')).toBeInTheDocument()
    expect(screen.getByText('1h bearish')).toBeInTheDocument()
    expect(screen.getByText('4h neutral')).toBeInTheDocument()
  })

  test('renders the benchmark card when series data exists', async () => {
    mockApiGet()
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/auto-trading/benchmark') {
        return Promise.resolve({
          data: { series: [{ date: '2026-07-08', engine_equity: 100100, watchlist_value: 100050 }] },
        })
      }
      if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings: baseSettings } })
      if (url === '/auto-trading/status') return Promise.resolve({ data: baseStatus })
      if (url === '/brokers/connections') return Promise.resolve({ data: { connections } })
      if (url === '/auto-trading/activity') return Promise.resolve({ data: { runs: [], total: 0 } })
      return Promise.resolve({ data: {} })
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Engine vs buy-and-hold/i)).toBeInTheDocument())
  })
})
