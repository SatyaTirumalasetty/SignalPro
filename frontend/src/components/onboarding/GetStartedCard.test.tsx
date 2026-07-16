import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { GetStartedCard } from './GetStartedCard'
import { api } from '@/lib/api'
import type { AutoTradingSettings, BrokerConnection } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

const connected: BrokerConnection[] = [{ id: 'conn-1', broker_id: 'alpaca', name: 'My Alpaca', status: 'connected' }]

function makeSettings(overrides: Partial<AutoTradingSettings> = {}): AutoTradingSettings {
  return {
    enabled: false,
    broker_connection_id: null,
    symbols: [],
    timeframes: [],
    min_confidence: 70,
    risk_per_trade_pct: 0.01,
    max_daily_loss_pct: 0.05,
    cooldown_minutes: 60,
    max_trades_per_day: 5,
    ...overrides,
  }
}

function mockState(connections: BrokerConnection[], settings: AutoTradingSettings) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections } })
    if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings } })
    return Promise.resolve({ data: {} })
  })
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GetStartedCard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { queryClient, ...utils }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('GetStartedCard', () => {
  test('new user: shows card at 0 of 3 with step 1 linking to /brokers', async () => {
    mockState([], makeSettings())
    renderCard()
    expect(await screen.findByText('Get started')).toBeInTheDocument()
    expect(screen.getByText('0 of 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Connect a broker/ })).toHaveAttribute('href', '/brokers')
    expect(screen.getByText(/Fund your account/)).toBeInTheDocument()
  })

  test('broker connected only: shows 1 of 3', async () => {
    mockState(connected, makeSettings())
    renderCard()
    expect(await screen.findByText('Get started')).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Configure Auto Trading/ })).toHaveAttribute('href', '/auto-trading')
  })

  test('configured but not enabled: shows 2 of 3', async () => {
    mockState(connected, makeSettings({ broker_connection_id: 'conn-1', symbols: ['AAPL'] }))
    renderCard()
    expect(await screen.findByText('Get started')).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  test('all steps done: renders nothing', async () => {
    mockState(connected, makeSettings({ broker_connection_id: 'conn-1', symbols: ['AAPL'], enabled: true }))
    const { queryClient } = renderCard()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(screen.queryByText('Get started')).not.toBeInTheDocument()
  })

  test('renders nothing while queries are loading', () => {
    ;(api.get as Mock).mockImplementation(() => new Promise(() => {}))
    renderCard()
    expect(screen.queryByText('Get started')).not.toBeInTheDocument()
  })

  test('dismissed on this device: renders nothing even when incomplete', async () => {
    localStorage.setItem('getStarted.dismissed', '1')
    mockState([], makeSettings())
    const { queryClient } = renderCard()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(screen.queryByText('Get started')).not.toBeInTheDocument()
  })

  test('clicking Dismiss hides the card and persists the flag', async () => {
    mockState([], makeSettings())
    renderCard()
    expect(await screen.findByText('Get started')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Dismiss/i }))
    expect(screen.queryByText('Get started')).not.toBeInTheDocument()
    expect(localStorage.getItem('getStarted.dismissed')).toBe('1')
  })
})
