import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { OrdersPage } from './OrdersPage'
import { api } from '@/lib/api'
import type { Order } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), delete: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const orders: Order[] = [
  {
    id: 'o1',
    symbol: 'AAPL',
    side: 'buy',
    order_type: 'market',
    quantity: 10,
    price: 150,
    stop_loss: 140,
    take_profit: 170,
    status: 'filled',
    created_at: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'o2',
    symbol: 'MSFT',
    side: 'sell',
    order_type: 'limit',
    quantity: 5,
    status: 'pending',
    created_at: '2026-06-02T00:00:00.000Z',
  },
]

function mockApiGet(overrides: Record<string, unknown> = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/trading/orders') return Promise.resolve({ data: { orders: overrides.orders ?? orders } })
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections: [] } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OrdersPage', () => {
  test('renders order history with statuses, prices, and SL/TP', async () => {
    mockApiGet()
    renderPage()

    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('Market')).toBeInTheDocument()
    expect(screen.getByText('140 / 170')).toBeInTheDocument()
  })

  test('shows a Cancel button for pending orders and cancels them', async () => {
    mockApiGet()
    ;(api.delete as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await screen.findByText('MSFT')
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/trading/orders/o2'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Order cancelled', 'success'))
  })

  test('shows an empty state and opens the place order dialog', async () => {
    mockApiGet({ orders: [] })
    renderPage()

    expect(await screen.findByText('No orders yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByText(/You need an active broker connection/)).toBeInTheDocument()
  })

  test('toggles the sort direction on the Created column', async () => {
    mockApiGet()
    renderPage()

    await screen.findByText('AAPL')
    fireEvent.click(screen.getByRole('button', { name: 'Created' }))
    expect(screen.getByText('AAPL')).toBeInTheDocument()
  })

  test('shows Cancel for open and partially_filled orders, not for filled', async () => {
    mockApiGet({
      orders: [
        {
          id: 'o1',
          symbol: 'AAPL',
          side: 'buy',
          order_type: 'market',
          quantity: 10,
          price: 150,
          stop_loss: 140,
          take_profit: 170,
          status: 'open',
          created_at: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'o2',
          symbol: 'MSFT',
          side: 'sell',
          order_type: 'limit',
          quantity: 5,
          status: 'partially_filled',
          created_at: '2026-06-02T00:00:00.000Z',
        },
        {
          id: 'o3',
          symbol: 'GOOGL',
          side: 'buy',
          order_type: 'market',
          quantity: 20,
          price: 140,
          status: 'filled',
          created_at: '2026-06-03T00:00:00.000Z',
        },
      ],
    })
    renderPage()
    const cancelButtons = await screen.findAllByRole('button', { name: 'Cancel' })
    expect(cancelButtons).toHaveLength(2)
  })
})
