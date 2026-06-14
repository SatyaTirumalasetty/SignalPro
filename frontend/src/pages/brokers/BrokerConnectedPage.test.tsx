import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, test, expect, vi } from 'vitest'
import { BrokerConnectedPage } from './BrokerConnectedPage'

const navigateFn = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateFn }
})

function renderPage(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/brokers/connected" element={<BrokerConnectedPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BrokerConnectedPage', () => {
  test('shows broker-specific success message', () => {
    renderPage('/brokers/connected?broker=alpaca')

    expect(screen.getByText('Your alpaca account has been connected successfully.')).toBeInTheDocument()
  })

  test('shows generic message and navigates back on click', async () => {
    renderPage('/brokers/connected')

    expect(screen.getByText('Your broker account has been connected.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back to broker connections' }))
    expect(navigateFn).toHaveBeenCalledWith('/brokers')
  })
})
