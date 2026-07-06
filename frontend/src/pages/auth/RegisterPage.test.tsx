import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { RegisterPage } from './RegisterPage'

const registerFn = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ register: registerFn }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  )
}

describe('RegisterPage', () => {
  test('registers and shows confirmation message', async () => {
    registerFn.mockResolvedValue(undefined)
    renderPage()

    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Trader Joe')
    await userEvent.type(screen.getByPlaceholderText('Email'), 'trader@example.com')
    await userEvent.type(screen.getByPlaceholderText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(registerFn).toHaveBeenCalledWith({
        email: 'trader@example.com',
        password: 'password123',
        full_name: 'Trader Joe',
      }),
    )
    expect(await screen.findByText('Check your email')).toBeInTheDocument()
  })

  test('shows error message on failed registration', async () => {
    registerFn.mockRejectedValue(new Error('Email already in use'))
    renderPage()

    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Trader Joe')
    await userEvent.type(screen.getByPlaceholderText('Email'), 'trader@example.com')
    await userEvent.type(screen.getByPlaceholderText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Email already in use')).toBeInTheDocument()
  })
})
