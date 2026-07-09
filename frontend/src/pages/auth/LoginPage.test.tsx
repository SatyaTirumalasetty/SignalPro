import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { LoginPage } from './LoginPage'

const loginFn = vi.fn()
const confirm2FAFn = vi.fn()
const navigateFn = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ login: loginFn, confirm2FA: confirm2FAFn }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateFn,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  test('logs in and navigates on success', async () => {
    loginFn.mockResolvedValue({ requires2FA: false })
    renderPage()

    await userEvent.type(screen.getByPlaceholderText('Email'), 'trader@example.com')
    await userEvent.type(screen.getByPlaceholderText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(loginFn).toHaveBeenCalledWith('trader@example.com', 'password123'))
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/', { replace: true }))
  })

  test('shows error message on failed login', async () => {
    loginFn.mockRejectedValue(new Error('Invalid credentials'))
    renderPage()

    await userEvent.type(screen.getByPlaceholderText('Email'), 'trader@example.com')
    await userEvent.type(screen.getByPlaceholderText('Password'), 'wrongpass')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
  })

  test('shows 2FA form when required and verifies code', async () => {
    loginFn.mockResolvedValue({ requires2FA: true, twoFaToken: 'token-123' })
    confirm2FAFn.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByPlaceholderText('Email'), 'trader@example.com')
    await userEvent.type(screen.getByPlaceholderText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Two-factor authentication')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('123456'), '654321')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(confirm2FAFn).toHaveBeenCalledWith('token-123', '654321'))
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/', { replace: true }))
  })
})
