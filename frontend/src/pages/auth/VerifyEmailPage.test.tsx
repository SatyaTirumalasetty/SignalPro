import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { VerifyEmailPage } from './VerifyEmailPage'
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
      <VerifyEmailPage />
    </MemoryRouter>,
  )
}

describe('VerifyEmailPage', () => {
  test('shows success message when verification succeeds', async () => {
    ;(api.post as Mock).mockResolvedValue({ data: {} })
    renderPage(['/verify-email?token=abc123'])

    expect(screen.getByText('Verifying your email…')).toBeInTheDocument()
    expect(await screen.findByText(/Your email has been verified/)).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/auth/verify-email', { token: 'abc123' })
  })

  test('shows error message when verification fails', async () => {
    ;(api.post as Mock).mockRejectedValue(new Error('Invalid token'))
    renderPage(['/verify-email?token=abc123'])

    expect(await screen.findByText('Invalid token')).toBeInTheDocument()
  })

  test('shows error when token is missing', () => {
    renderPage(['/verify-email'])

    expect(screen.getByText('Missing verification token')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })
})
