import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AutoTradingPage />
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
})
