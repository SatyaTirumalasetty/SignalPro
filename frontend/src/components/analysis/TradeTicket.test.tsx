import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { TradeTicket } from './TradeTicket'
import { api } from '@/lib/api'
import type { Signal } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  getApiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error'),
}))
const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: toastFn }) }))

const signal: Signal = {
  id: 'sig-1', symbol: 'AAPL', signal_type: 'buy', confidence: 82,
  entry_price: 150, stop_loss: 145, take_profit: 160,
}

function mockGets() {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections: [{ id: 'conn-1', name: 'Alpaca Paper', broker_id: 'alpaca', status: 'connected' }] } })
    if (url === '/brokers/connections/conn-1/accounts') return Promise.resolve({ data: { account: { funds: { equity: 100000 } } } })
    if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings: { risk_per_trade_pct: 0.01 } } })
    if (url === '/users/me') return Promise.resolve({ data: { user: { preferences: {} } } })
    return Promise.resolve({ data: {} })
  })
}

function renderTicket(props: Partial<Parameters<typeof TradeTicket>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TradeTicket symbol="AAPL" signal={signal} currentPrice={150} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGets()
  ;(api.post as Mock).mockResolvedValue({ data: { order: { id: 'order-1' } } })
})

describe('TradeTicket', () => {
  test('pre-fills side, stops, and risk-sized quantity from the signal', async () => {
    renderTicket()
    await waitFor(() => expect(screen.getByLabelText(/quantity/i)).toHaveValue(200))
    expect(screen.getByLabelText(/stop loss/i)).toHaveValue(145)
    expect(screen.getByLabelText(/take profit/i)).toHaveValue(160)
    expect(screen.getByRole('button', { name: /^buy$/i })).toHaveAttribute('data-active', 'true')
  })

  test('confirm posts a snake_case bracket order with signal linkage', async () => {
    renderTicket()
    await waitFor(() => expect(screen.getByLabelText(/quantity/i)).toHaveValue(200))
    fireEvent.click(screen.getByRole('button', { name: /confirm buy/i }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/trading/orders', {
        broker_connection_id: 'conn-1',
        symbol: 'AAPL',
        side: 'buy',
        order_type: 'market',
        quantity: 200,
        stop_loss: 145,
        take_profit: 160,
        signal_id: 'sig-1',
      }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Order placed', 'success'))
  })

  test('broker rejection keeps the ticket values and shows the message', async () => {
    ;(api.post as Mock).mockRejectedValue(new Error('insufficient buying power'))
    renderTicket()
    await waitFor(() => expect(screen.getByLabelText(/quantity/i)).toHaveValue(200))
    fireEvent.click(screen.getByRole('button', { name: /confirm buy/i }))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('insufficient buying power', 'error'))
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(200)
  })

  test('equity failure leaves quantity blank with a hint', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/brokers/connections') return Promise.resolve({ data: { connections: [{ id: 'conn-1', name: 'Alpaca Paper', broker_id: 'alpaca', status: 'connected' }] } })
      if (url === '/brokers/connections/conn-1/accounts') return Promise.reject(new Error('broker down'))
      if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings: { risk_per_trade_pct: 0.01 } } })
      if (url === '/users/me') return Promise.resolve({ data: { user: { preferences: {} } } })
      return Promise.resolve({ data: {} })
    })
    renderTicket()
    await waitFor(() => expect(screen.getByText(/couldn't size from account equity/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(null)
  })

  test('instant-orders toggle persists to preferences', async () => {
    ;(api.put as Mock).mockResolvedValue({ data: {} })
    renderTicket()
    await waitFor(() => expect(screen.getByRole('switch', { name: /instant orders/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('switch', { name: /instant orders/i }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/users/me', {
        preferences: expect.objectContaining({ trading: expect.objectContaining({ instant_orders: true }) }),
      }),
    )
  })

  test('confirm is disabled for non-positive quantity', async () => {
    renderTicket()
    await waitFor(() => expect(screen.getByLabelText(/quantity/i)).toHaveValue(200))
    const quantityInput = screen.getByLabelText(/quantity/i)
    fireEvent.change(quantityInput, { target: { value: '0' } })
    const confirmBtn = screen.getByRole('button', { name: /confirm buy/i })
    expect(confirmBtn).toBeDisabled()
  })
})
