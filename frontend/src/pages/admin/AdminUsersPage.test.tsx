import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { AdminUsersPage } from './AdminUsersPage'
import { api } from '@/lib/api'
import type { AdminActivityEntry, AdminUserDetail, AdminUserSummary } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const users: AdminUserSummary[] = [
  {
    id: 'u1',
    email: 'trader@example.com',
    full_name: 'Trader Joe',
    status: 'active',
    kyc_status: 'pending',
    email_verified: true,
    created_at: '2026-05-01T00:00:00.000Z',
    totp_enabled: false,
    subscription_status: 'active',
    plan_tier: 'pro',
    broker_count: 1,
  },
  {
    id: 'u2',
    email: 'suspended@example.com',
    full_name: 'Suspended User',
    status: 'suspended',
    kyc_status: 'verified',
    email_verified: true,
    created_at: '2026-05-02T00:00:00.000Z',
    totp_enabled: false,
    subscription_status: null,
    plan_tier: null,
    broker_count: 0,
  },
]

const userDetail: AdminUserDetail = {
  id: 'u1',
  email: 'trader@example.com',
  full_name: 'Trader Joe',
  status: 'active',
  kyc_status: 'pending',
  email_verified: true,
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-10T00:00:00.000Z',
  totp_enabled: false,
  subscription_status: 'active',
  plan_name: 'Pro',
  plan_tier: 'pro',
} as AdminUserDetail

const activity: AdminActivityEntry[] = [
  { action: 'login', entity_type: 'session', status: 'success', created_at: '2026-05-10T00:00:00.000Z' },
]

function mockApi(overrides: { users?: AdminUserSummary[]; total?: number } = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/admin/users') return Promise.resolve({ data: { users: overrides.users ?? users, total: overrides.total ?? users.length, limit: 50, offset: 0 } })
    if (url === '/admin/users/u1') return Promise.resolve({ data: { user: userDetail, recent_activity: activity } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminUsersPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminUsersPage', () => {
  test('renders the users table', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('Trader Joe')).toBeInTheDocument()
    expect(screen.getByText('2 users')).toBeInTheDocument()
    expect(screen.getByText('Suspended User')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unsuspend' })).toBeInTheDocument()
  })

  test('shows empty state when there are no users', async () => {
    mockApi({ users: [], total: 0 })
    renderPage()

    expect(await screen.findByText('No users match these filters.')).toBeInTheDocument()
  })

  test('opens user detail dialog and shows recent activity', async () => {
    mockApi()
    renderPage()

    await userEvent.click(await screen.findByText('Trader Joe'))

    expect(await screen.findByText('User details')).toBeInTheDocument()
    expect(await screen.findByText('login')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve KYC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject KYC' })).toBeInTheDocument()
  })

  test('suspends a user', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: { message: 'User suspended' } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
    expect(await screen.findByRole('heading', { name: 'Suspend user' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Suspend user' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/u1/suspend', { reason: undefined }))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('User suspended', 'success'))
  })

  test('unsuspends a user', async () => {
    mockApi()
    ;(api.delete as Mock).mockResolvedValue({ data: { message: 'User unsuspended' } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Unsuspend' }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/users/u2/suspend'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('User unsuspended', 'success'))
  })
})
