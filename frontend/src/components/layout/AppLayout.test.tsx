import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, test, expect, vi } from 'vitest'
import { AppLayout } from './AppLayout'

const logoutFn = vi.fn()
const navigateFn = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { email: 'admin@example.com', role: 'admin' },
    logout: logoutFn,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateFn }
})

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<div>Home content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppLayout', () => {
  test('renders navigation links, admin link, and the outlet content', () => {
    renderLayout()

    expect(screen.getByText('Home content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Admin/ })).toBeInTheDocument()
  })

  test('opens the user menu and triggers settings navigation and sign out', async () => {
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByText('admin@example.com'))
    await user.click(await screen.findByRole('menuitem', { name: 'Settings' }))
    expect(navigateFn).toHaveBeenCalledWith('/settings')

    await user.click(screen.getByText('admin@example.com'))
    await user.click(await screen.findByText('Sign out'))
    expect(logoutFn).toHaveBeenCalled()
  })

  test('opens the mobile nav drawer', async () => {
    renderLayout()

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect((await screen.findAllByText('SignalPro')).length).toBeGreaterThan(1)
  })
})
