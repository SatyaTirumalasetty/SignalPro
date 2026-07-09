import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { ResetPasswordPage } from './ResetPasswordPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ResetPasswordPage />
    </MemoryRouter>,
  )
}

describe('ResetPasswordPage', () => {
  test('submits new password with token and shows confirmation', async () => {
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage(['/reset-password?token=abc123'])

    await userEvent.type(screen.getByPlaceholderText('New password'), 'newpassword123')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { token: 'abc123', password: 'newpassword123' }),
    )
    expect(await screen.findByText('Password updated')).toBeInTheDocument()
  })

  test('shows missing token message and disables submit when no token', () => {
    renderPage(['/reset-password'])

    expect(screen.getByText('Missing reset token — use the link from your email.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled()
  })

  test('shows error message on failure', async () => {
    ;(api.post as Mock).mockRejectedValue(new Error('Token expired'))
    renderPage(['/reset-password?token=abc123'])

    await userEvent.type(screen.getByPlaceholderText('New password'), 'newpassword123')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByText('Token expired')).toBeInTheDocument()
  })
})
