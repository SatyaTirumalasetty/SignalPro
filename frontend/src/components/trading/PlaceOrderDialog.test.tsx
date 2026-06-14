import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { PlaceOrderDialog } from './PlaceOrderDialog'
import { api } from '@/lib/api'
import type { BrokerConnection } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const connectedConnections: BrokerConnection[] = [
  { id: 'conn-1', broker_id: 'alpaca', name: 'My Alpaca', status: 'connected' },
]

function mockConnections(connections: BrokerConnection[]) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections } })
    return Promise.resolve({ data: {} })
  })
}

function renderDialog(props: Partial<Parameters<typeof PlaceOrderDialog>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlaceOrderDialog open onClose={onClose} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PlaceOrderDialog', () => {
  test('prompts to connect a broker when there are no connected accounts', async () => {
    mockConnections([])
    const { onClose } = renderDialog()

    expect(await screen.findByText(/You need an active broker connection/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Connect a broker' })
    fireEvent.click(link)
    expect(onClose).toHaveBeenCalled()
  })

  test('pre-fills from initialValues when opened', async () => {
    mockConnections(connectedConnections)
    renderDialog({
      initialValues: { symbol: 'AAPL', side: 'sell', stopLoss: 100, takeProfit: 200, signalId: 'sig-1' },
    })

    expect(await screen.findByDisplayValue('AAPL')).toBeInTheDocument()
    expect(screen.getByDisplayValue('100')).toBeInTheDocument()
    expect(screen.getByDisplayValue('200')).toBeInTheDocument()
    expect(screen.getByText(/Pre-filled from an AI signal for AAPL/)).toBeInTheDocument()
  })

  test('submits a market order with the default connection', async () => {
    mockConnections(connectedConnections)
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderDialog()

    const symbolInput = await screen.findByPlaceholderText('Symbol (e.g. AAPL)')
    fireEvent.change(symbolInput, { target: { value: 'msft' } })
    fireEvent.change(screen.getByPlaceholderText('Quantity'), { target: { value: '10' } })

    fireEvent.click(screen.getByRole('button', { name: 'Place order' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/trading/orders', {
        broker_connection_id: 'conn-1',
        symbol: 'MSFT',
        side: 'buy',
        order_type: 'market',
        quantity: 10,
      }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Order placed', 'success'))
  })

  test('includes stop loss, take profit, and signal id when present', async () => {
    mockConnections(connectedConnections)
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderDialog({ initialValues: { symbol: 'AAPL', side: 'buy', stopLoss: 90, takeProfit: 120, signalId: 'sig-1' } })

    await screen.findByDisplayValue('AAPL')
    fireEvent.change(screen.getByPlaceholderText('Quantity'), { target: { value: '5' } })

    fireEvent.click(screen.getByRole('button', { name: 'Place order' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/trading/orders', {
        broker_connection_id: 'conn-1',
        symbol: 'AAPL',
        side: 'buy',
        order_type: 'market',
        quantity: 5,
        stop_loss: 90,
        take_profit: 120,
        signal_id: 'sig-1',
      }),
    )
  })

  test('shows an error message when placing an order fails', async () => {
    mockConnections(connectedConnections)
    ;(api.post as Mock).mockRejectedValue(new Error('Insufficient funds'))
    renderDialog()

    fireEvent.change(await screen.findByPlaceholderText('Symbol (e.g. AAPL)'), { target: { value: 'AAPL' } })
    fireEvent.change(screen.getByPlaceholderText('Quantity'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }))

    expect(await screen.findByText('Insufficient funds')).toBeInTheDocument()
  })

  test('renders nothing when closed', () => {
    mockConnections(connectedConnections)
    renderDialog({ open: false })
    expect(screen.queryByText('Place order')).not.toBeInTheDocument()
  })
})
