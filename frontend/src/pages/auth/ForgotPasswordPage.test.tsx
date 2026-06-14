import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  )
}

describe('ForgotPasswordPage', () => {
  test('submits email and shows confirmation', async () => {
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage()

    await userEvent.type(screen.getByPlaceholderText('Email'), 'trader@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'trader@example.com' }))
    expect(await screen.findByText('Check your email')).toBeInTheDocument()
  })

  test('shows error message on failure', async () => {
    ;(api.post as Mock).mockRejectedValue(new Error('Something went wrong'))
    renderPage()

    await userEvent.type(screen.getByPlaceholderText('Email'), 'trader@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })
})
