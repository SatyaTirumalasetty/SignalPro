import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, test, expect, vi } from 'vitest'
import { ProtectedRoute } from './ProtectedRoute'

const useAuthMock = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/dashboard" element={<ProtectedRoute />}>
          <Route index element={<div>Dashboard content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  test('shows loading state', () => {
    useAuthMock.mockReturnValue({ status: 'loading' })
    renderRoute()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  test('redirects to login when unauthenticated', () => {
    useAuthMock.mockReturnValue({ status: 'unauthenticated' })
    renderRoute()
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  test('renders outlet when authenticated', () => {
    useAuthMock.mockReturnValue({ status: 'authenticated' })
    renderRoute()
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })
})
