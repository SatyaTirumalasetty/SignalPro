import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { CalibrationPanel } from './CalibrationPanel'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('CalibrationPanel', () => {
  test('renders bucket rows when there is enough data', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: {
      buckets: [ { range: '70-80', trades: 6, win_rate: 0.67 }, { range: '80-90', trades: 5, win_rate: 0.8 } ],
      total_closed: 11, min_required: 10, sufficient: true,
    } })
    renderWithClient(<CalibrationPanel />)
    expect(await screen.findByText('70-80')).toBeInTheDocument()
    expect(screen.getByText('67.0%')).toBeInTheDocument()
    expect(screen.getByText('80-90')).toBeInTheDocument()
  })

  test('shows insufficient-data message below the threshold', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { buckets: [], total_closed: 3, min_required: 10, sufficient: false } })
    renderWithClient(<CalibrationPanel />)
    expect(await screen.findByText(/needs at least 10 closed trades/i)).toBeInTheDocument()
    expect(await screen.findByText(/3 so far/i)).toBeInTheDocument()
  })
})
