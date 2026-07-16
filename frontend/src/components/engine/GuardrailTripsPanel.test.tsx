import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { GuardrailTripsPanel } from './GuardrailTripsPanel'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('GuardrailTripsPanel', () => {
  test('lists skip reasons with counts when sufficient', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: {
      trips: [ { action: 'skipped_low_confidence', count: 24 }, { action: 'skipped_existing_position', count: 13 } ],
      total_runs: 140, min_required: 20, sufficient: true,
    } })
    renderWithClient(<GuardrailTripsPanel />)
    expect(await screen.findByText('skipped_low_confidence')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('skipped_existing_position')).toBeInTheDocument()
  })

  test('shows insufficient message below threshold', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { trips: [], total_runs: 5, min_required: 20, sufficient: false } })
    renderWithClient(<GuardrailTripsPanel />)
    expect(await screen.findByText(/needs at least 20 cycles/i)).toBeInTheDocument()
  })
})
