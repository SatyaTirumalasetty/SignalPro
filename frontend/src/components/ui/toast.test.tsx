import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { ToastProvider } from './toast'
import { useToast } from '@/hooks/useToast'

function TestConsumer() {
  const { toast } = useToast()
  return (
    <div>
      <button onClick={() => toast('Saved successfully', 'success')}>show-success</button>
      <button onClick={() => toast('Something failed', 'error')}>show-error</button>
      <button onClick={() => toast('Default message')}>show-default</button>
    </div>
  )
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <TestConsumer />
    </ToastProvider>,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  test('renders a success toast when triggered', async () => {
    renderWithProvider()
    await userEvent.click(screen.getByText('show-success'))
    expect(await screen.findByText('Saved successfully')).toBeInTheDocument()
  })

  test('renders an error toast when triggered', async () => {
    renderWithProvider()
    await userEvent.click(screen.getByText('show-error'))
    expect(await screen.findByText('Something failed')).toBeInTheDocument()
  })

  test('renders a default toast when no variant given', async () => {
    renderWithProvider()
    await userEvent.click(screen.getByText('show-default'))
    expect(await screen.findByText('Default message')).toBeInTheDocument()
  })

  test('removes the toast after the timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    renderWithProvider()

    await user.click(screen.getByText('show-success'))
    expect(screen.getByText('Saved successfully')).toBeInTheDocument()

    vi.advanceTimersByTime(4000)

    await waitFor(() => expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument())
  })
})
