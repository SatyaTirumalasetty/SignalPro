import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { AdminSupportPage } from './AdminSupportPage'
import { api } from '@/lib/api'
import type { SupportTicket } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const tickets: SupportTicket[] = [
  {
    id: 't1',
    user_id: 'u1',
    title: 'Cannot place order',
    description: 'Order keeps failing',
    category: 'trading',
    priority: 'high',
    status: 'open',
    user_email: 'trader@example.com',
    user_name: 'Trader Joe',
    created_at: '2026-06-01T00:00:00.000Z',
    assigned_to: null,
    resolved_at: null,
  } as SupportTicket,
]

function mockApi(overrides: { tickets?: SupportTicket[]; total?: number } = {}) {
  ;(api.get as Mock).mockResolvedValue({ data: { tickets: overrides.tickets ?? tickets, total: overrides.total ?? tickets.length } })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminSupportPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminSupportPage', () => {
  test('renders the tickets table', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('Cannot place order')).toBeInTheDocument()
    expect(screen.getByText('1 ticket')).toBeInTheDocument()
    expect(screen.getByText('Trader Joe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument()
  })

  test('shows empty state when there are no tickets', async () => {
    mockApi({ tickets: [], total: 0 })
    renderPage()

    expect(await screen.findByText('No tickets match these filters.')).toBeInTheDocument()
  })

  test('assigns a ticket to an admin', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Assign' }))
    await userEvent.type(screen.getByPlaceholderText('Admin user ID (UUID)'), 'admin-123')
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/support/tickets/t1/assign', { admin_id: 'admin-123' }))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Ticket assigned', 'success'))
  })

  test('resolves a ticket with notes', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Resolve' }))
    await userEvent.type(screen.getByPlaceholderText('Resolution notes'), 'Fixed the broker connection')
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/support/tickets/t1/resolve', { resolution_notes: 'Fixed the broker connection' }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Ticket resolved', 'success'))
  })
})
