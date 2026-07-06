import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { AuthProvider } from './AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { api, getRefreshToken, setTokens, setUnauthorizedHandler } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getRefreshToken: vi.fn(),
  setTokens: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}))

function TestConsumer() {
  const { user, status, login, confirm2FA, register, logout, refreshUser } = useAuth()
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="user">{user ? user.email : 'none'}</div>
      <button onClick={() => login('a@b.com', 'pw').catch(() => {})}>login</button>
      <button onClick={() => confirm2FA('2fa-token', '123456')}>confirm2fa</button>
      <button onClick={() => register({ email: 'a@b.com', password: 'pw', full_name: 'A B' })}>register</button>
      <button onClick={() => logout()}>logout</button>
      <button onClick={() => refreshUser()}>refresh</button>
    </div>
  )
}

function renderProvider() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getRefreshToken as Mock).mockReturnValue(null)
})

describe('AuthProvider', () => {
  test('starts unauthenticated when no refresh token exists', async () => {
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))
    expect(setUnauthorizedHandler).toHaveBeenCalled()
  })

  test('loads user when a refresh token exists', async () => {
    ;(getRefreshToken as Mock).mockReturnValue('refresh-token')
    ;(api.post as Mock).mockResolvedValue({ data: { accessToken: 'access-token' } })
    ;(api.get as Mock).mockResolvedValue({ data: { user: { email: 'trader@example.com' } } })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user').textContent).toBe('trader@example.com')
    expect(api.post).toHaveBeenCalledWith('/auth/refresh', { refreshToken: 'refresh-token' })
  })

  test('clears session when refresh fails', async () => {
    ;(getRefreshToken as Mock).mockReturnValue('refresh-token')
    ;(api.post as Mock).mockRejectedValue(new Error('expired'))

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))
    expect(setTokens).toHaveBeenCalledWith({ accessToken: null, refreshToken: null })
  })

  test('login sets tokens and user on success', async () => {
    ;(api.post as Mock).mockResolvedValue({
      data: { accessToken: 'a', refreshToken: 'r', user: { email: 'trader@example.com' }, requires_2fa: false },
    })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user').textContent).toBe('trader@example.com')
    expect(setTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' })
  })

  test('confirm2FA sets tokens and user', async () => {
    ;(api.post as Mock).mockResolvedValue({
      data: { accessToken: 'a', refreshToken: 'r', user: { email: 'trader@example.com' } },
    })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))

    await userEvent.click(screen.getByText('confirm2fa'))

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(api.post).toHaveBeenCalledWith('/auth/2fa/challenge', { two_fa_token: '2fa-token', code: '123456' })
  })

  test('register posts payload', async () => {
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))

    await userEvent.click(screen.getByText('register'))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/register', { email: 'a@b.com', password: 'pw', full_name: 'A B' }),
    )
  })

  test('logout clears session even if API call fails', async () => {
    ;(api.post as Mock).mockRejectedValue(new Error('network error'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'))

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(setTokens).toHaveBeenCalledWith({ accessToken: null, refreshToken: null }))
  })
})
