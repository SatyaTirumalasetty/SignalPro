import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { SettingsPage } from './SettingsPage'
import { api } from '@/lib/api'
import type { ApiKey, Session, TwoFaSetupResponse, User } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const refreshUserFn = vi.fn()
let currentUser: User = {
  id: 'u1',
  email: 'trader@example.com',
  full_name: 'Trader Joe',
  phone: '+1 555 0100',
  country: 'US',
  totp_enabled: false,
}

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: currentUser, refreshUser: refreshUserFn }),
}))

const sessions: Session[] = [
  { id: 's1', ip_address: '1.2.3.4', user_agent: 'Chrome', device_name: 'Chrome on Mac', last_activity: '2026-06-10T00:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z', expires_at: '2026-07-01T00:00:00.000Z' },
]

const apiKeys: ApiKey[] = [
  { id: 'k1', name: 'Trading bot', last_used_at: '2026-06-10T00:00:00.000Z', last_ip: null, rate_limit: null, scope: [], active: true, created_at: '2026-06-01T00:00:00.000Z', expires_at: null },
]

const twoFaSetup: TwoFaSetupResponse = { secret: 'SECRET123', otpauth_url: 'otpauth://totp/...', qr_code: 'data:image/png;base64,abc' }

function mockApi(overrides: { sessions?: Session[]; apiKeys?: ApiKey[] } = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/users/me/sessions') return Promise.resolve({ data: { sessions: overrides.sessions ?? sessions } })
    if (url === '/api-keys') return Promise.resolve({ data: { api_keys: overrides.apiKeys ?? apiKeys } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  currentUser = {
    id: 'u1',
    email: 'trader@example.com',
    full_name: 'Trader Joe',
    phone: '+1 555 0100',
    country: 'US',
    totp_enabled: false,
  }
})

describe('SettingsPage - Profile', () => {
  test('updates profile information', async () => {
    mockApi()
    ;(api.put as Mock).mockResolvedValue({ data: {} })
    renderPage()

    const nameInput = await screen.findByDisplayValue('Trader Joe')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Trader Jane')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/users/me', { full_name: 'Trader Jane', phone: '+1 555 0100', country: 'US' }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Profile updated', 'success'))
    await waitFor(() => expect(refreshUserFn).toHaveBeenCalled())
  })
})

describe('SettingsPage - Password', () => {
  test('changes password', async () => {
    mockApi()
    ;(api.put as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.type(await screen.findByPlaceholderText('Current password'), 'oldpass123')
    await userEvent.type(screen.getByPlaceholderText('New password (min. 8 characters)'), 'newpass123')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/users/me/password', { current_password: 'oldpass123', new_password: 'newpass123' }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Password changed. Please log in again.', 'success'))
  })
})

describe('SettingsPage - Two-factor', () => {
  test('sets up and enables 2FA', async () => {
    mockApi()
    ;(api.post as Mock).mockImplementation((url: string) => {
      if (url === '/auth/2fa/setup') return Promise.resolve({ data: twoFaSetup })
      if (url === '/auth/2fa/enable') return Promise.resolve({ data: {} })
      return Promise.resolve({ data: {} })
    })
    renderPage()

    expect(await screen.findByText('Disabled')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Set up 2FA' }))

    expect(await screen.findByText(/enter this secret manually/)).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('6-digit code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and enable' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/2fa/enable', { totp_code: '123456' }))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Two-factor authentication enabled', 'success'))
    await waitFor(() => expect(refreshUserFn).toHaveBeenCalled())
  })

  test('disables 2FA when already enabled', async () => {
    currentUser = { ...currentUser, totp_enabled: true }
    mockApi()
    ;(api.delete as Mock).mockImplementation((url: string) => {
      if (url === '/auth/2fa') return Promise.resolve({ data: {} })
      return Promise.resolve({ data: {} })
    })
    renderPage()

    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }))

    await userEvent.type(screen.getByPlaceholderText('6-digit code'), '654321')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm disable' }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/auth/2fa', { data: { totp_code: '654321' } }))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Two-factor authentication disabled', 'success'))
  })
})

describe('SettingsPage - Sessions', () => {
  test('renders sessions and revokes one', async () => {
    mockApi()
    ;(api.delete as Mock).mockResolvedValue({ data: {} })
    renderPage()

    expect(await screen.findByText('Chrome on Mac')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/users/me/sessions/s1'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Session revoked', 'success'))
  })

  test('revokes all sessions', async () => {
    mockApi()
    ;(api.delete as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/users/me/sessions'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('All sessions revoked', 'success'))
  })

  test('shows empty state when there are no sessions', async () => {
    mockApi({ sessions: [] })
    renderPage()

    expect(await screen.findByText('No active sessions.')).toBeInTheDocument()
  })
})

describe('SettingsPage - API keys', () => {
  test('renders api keys and creates a new key', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: { api_key: { id: 'k2', name: 'New key', key: 'sk_live_abc123', created_at: '2026-06-12T00:00:00.000Z' }, warning: 'Store this key safely.' } })
    renderPage()

    expect(await screen.findByText('Trading bot')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /New API key/ }))

    await userEvent.type(screen.getByPlaceholderText('Key name (e.g. Trading bot)'), 'New key')
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api-keys', { name: 'New key' }))
    expect(await screen.findByText('sk_live_abc123')).toBeInTheDocument()
    expect(screen.getByText('Store this key safely.')).toBeInTheDocument()
  })

  test('revokes an api key', async () => {
    mockApi()
    ;(api.delete as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await screen.findByText('Trading bot')
    const revokeButtons = screen.getAllByRole('button')
    const revokeButton = revokeButtons.find((b) => b.querySelector('svg.lucide-trash2'))
    expect(revokeButton).toBeTruthy()
    await userEvent.click(revokeButton!)

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api-keys/k1'))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('API key revoked', 'success'))
  })

  test('shows empty state when there are no api keys', async () => {
    mockApi({ apiKeys: [] })
    renderPage()

    expect(await screen.findByText('No API keys yet.')).toBeInTheDocument()
  })
})
