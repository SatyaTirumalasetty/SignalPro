import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, test, expect, vi } from 'vitest'
import { AdminRoute } from './AdminRoute'

const useAuthMock = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/" element={<div>Home page</div>} />
        <Route path="/admin" element={<AdminRoute />}>
          <Route index element={<div>Admin content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminRoute', () => {
  test('shows loading state', () => {
    useAuthMock.mockReturnValue({ user: null, status: 'loading' })
    renderRoute()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  test('redirects to login when unauthenticated', () => {
    useAuthMock.mockReturnValue({ user: null, status: 'unauthenticated' })
    renderRoute()
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  test('redirects to home when authenticated but not admin', () => {
    useAuthMock.mockReturnValue({ user: { role: 'user' }, status: 'authenticated' })
    renderRoute()
    expect(screen.getByText('Home page')).toBeInTheDocument()
  })

  test('renders outlet for admin user', () => {
    useAuthMock.mockReturnValue({ user: { role: 'admin' }, status: 'authenticated' })
    renderRoute()
    expect(screen.getByText('Admin content')).toBeInTheDocument()
  })

  test('renders outlet for super_admin user', () => {
    useAuthMock.mockReturnValue({ user: { role: 'super_admin' }, status: 'authenticated' })
    renderRoute()
    expect(screen.getByText('Admin content')).toBeInTheDocument()
  })
})
