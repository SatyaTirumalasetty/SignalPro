import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { AdminOverviewPage } from './AdminOverviewPage'
import { api, getApiErrorMessage } from '@/lib/api'
import type { SystemAlert, SystemHealth } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const health: SystemHealth = {
  metrics: { active_users: 120, active_subscriptions: 80, open_support_tickets: 3, connected_brokers: 12 },
  recent_errors: [{ action: 'place_order', entity_type: 'order', error_message: 'Broker timeout', created_at: '2026-06-01T00:00:00.000Z' }],
}

const alerts: SystemAlert[] = [
  { id: 'a1', alert_type: 'broker_outage', severity: 'critical', message: 'Alpaca is down', status: 'open', created_at: '2026-06-01T00:00:00.000Z' },
]

function mockApi(overrides: { health?: SystemHealth | null; alerts?: SystemAlert[] } = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/admin/system/health') return Promise.resolve({ data: overrides.health ?? health })
    if (url === '/admin/system/alerts') return Promise.resolve({ data: { alerts: overrides.alerts ?? alerts } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminOverviewPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminOverviewPage', () => {
  test('renders metric cards, alerts, and recent errors', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('120')).toBeInTheDocument()
    expect(screen.getByText('Active subscriptions')).toBeInTheDocument()
    expect(await screen.findByText('broker_outage')).toBeInTheDocument()
    expect(screen.getByText('Alpaca is down')).toBeInTheDocument()
    expect(screen.getByText('Broker timeout')).toBeInTheDocument()
  })

  test('shows empty states when there is no data', async () => {
    mockApi({ health: { metrics: { active_users: 0, active_subscriptions: 0, open_support_tickets: 0, connected_brokers: 0 }, recent_errors: [] }, alerts: [] })
    renderPage()

    expect(await screen.findByText('No active alerts.')).toBeInTheDocument()
    expect(screen.getByText('No recent errors.')).toBeInTheDocument()
  })

  test('creates a new alert', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'New alert' }))
    await userEvent.type(screen.getByPlaceholderText('Alert type (e.g. broker_outage)'), 'high_latency')
    await userEvent.type(screen.getByPlaceholderText('Message'), 'API latency is elevated')
    await userEvent.click(screen.getByRole('button', { name: 'Create alert' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/system/alerts', {
        alert_type: 'high_latency',
        severity: 'info',
        message: 'API latency is elevated',
      }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Alert created', 'success'))
  })

  test('shows error toast when creating an alert fails', async () => {
    mockApi()
    ;(api.post as Mock).mockRejectedValue(new Error('Server error'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'New alert' }))
    await userEvent.type(screen.getByPlaceholderText('Alert type (e.g. broker_outage)'), 'high_latency')
    await userEvent.type(screen.getByPlaceholderText('Message'), 'API latency is elevated')
    await userEvent.click(screen.getByRole('button', { name: 'Create alert' }))

    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(getApiErrorMessage(new Error('Server error')), 'error'))
  })
})
