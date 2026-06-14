import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, test, expect, vi } from 'vitest'
import { AdminLayout } from './AdminLayout'

const logoutFn = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@example.com' }, logout: logoutFn }),
}))

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<div>Admin content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminLayout', () => {
  test('renders nav items, user email, and outlet content', () => {
    renderLayout()

    expect(screen.getByText('Admin content')).toBeInTheDocument()
    expect(screen.getByText('SignalPro Admin')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Overview/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Users/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Billing/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Signals/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Support/ })).toBeInTheDocument()
  })

  test('signs out when clicking the sign out button', async () => {
    renderLayout()
    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }))
    expect(logoutFn).toHaveBeenCalled()
  })
})
