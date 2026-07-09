import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { BrokersPage } from './BrokersPage'
import { api } from '@/lib/api'
import type { BrokerConnection, SupportedBroker } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const supported: SupportedBroker[] = [
  { id: 'alpaca', name: 'Alpaca', description: 'US equities', markets: ['US'], auth_type: 'api_key', credential_fields: [{ key: 'api_key', label: 'API Key', type: 'text', required: true }, { key: 'paper', label: 'Paper Trading (sandbox)', type: 'boolean', required: false }] },
]

const connections: BrokerConnection[] = [
  { id: 'c1', broker_id: 'alpaca', name: 'My Alpaca', status: 'connected', connected_at: '2026-06-01T00:00:00.000Z', last_sync: '2026-06-10T00:00:00.000Z' },
]

function mockApi(overrides: { connections?: BrokerConnection[] } = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/brokers/supported') return Promise.resolve({ data: { brokers: supported } })
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections: overrides.connections ?? connections } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrokersPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BrokersPage', () => {
  test('renders connections and available brokers', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('My Alpaca')).toBeInTheDocument()
    expect(screen.getByText('connected')).toBeInTheDocument()
    expect(screen.getByText('Alpaca')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  test('shows empty state when there are no connections', async () => {
    mockApi({ connections: [] })
    renderPage()

    expect(await screen.findByText('No broker connections yet. Connect one below to get started.')).toBeInTheDocument()
  })

  test('syncs a connected broker', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Sync/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/brokers/connections/c1/sync'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Sync started', 'success'))
  })

  test('connects a new broker with api key credentials', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Connect/ }))
    expect(await screen.findByText('Connect Alpaca')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('API Key *'), 'secret-key')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/brokers/connect', { broker_id: 'alpaca', credentials: { api_key: 'secret-key' }, name: undefined }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Broker connected', 'success'))
  })

  test('boolean credential fields render as a switch and submit as booleans', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Connect/ }))
    expect(await screen.findByText('Connect Alpaca')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('API Key *'), 'secret-key')
    await userEvent.click(screen.getByRole('switch', { name: /paper trading/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/brokers/connect', {
        broker_id: 'alpaca',
        credentials: { api_key: 'secret-key', paper: true },
        name: undefined,
      }),
    )
  })

  test('disconnects a broker', async () => {
    mockApi()
    ;(api.delete as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Disconnect/ }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/brokers/connections/c1'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Broker disconnected', 'success'))
  })
})
