import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { AdminBillingPage } from './AdminBillingPage'
import { api } from '@/lib/api'
import type { AdminMrrPoint, AdminRevenueByPlan } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

const monthly: AdminMrrPoint[] = [{ month: '2026-05-01T00:00:00.000Z', mrr: '4500', new_subs: '12' }]
const plans: AdminRevenueByPlan[] = [{ name: 'Pro', tier: 'pro', subscriber_count: '40', mrr: '4000' }]

function mockApi(overrides: { mrr?: number; monthly?: AdminMrrPoint[]; plans?: AdminRevenueByPlan[] } = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/admin/billing/mrr') return Promise.resolve({ data: { current_mrr: overrides.mrr ?? 5000, monthly_breakdown: overrides.monthly ?? monthly } })
    if (url === '/admin/billing/revenue-by-plan') return Promise.resolve({ data: { plans: overrides.plans ?? plans } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminBillingPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminBillingPage', () => {
  test('renders MRR, monthly breakdown, and revenue by plan', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('$5,000.00')).toBeInTheDocument()
    expect(await screen.findByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('pro')).toBeInTheDocument()
    expect(screen.getByText('$4,000.00')).toBeInTheDocument()
  })

  test('shows empty states when there is no billing data', async () => {
    mockApi({ monthly: [], plans: [] })
    renderPage()

    expect(await screen.findByText('No billing history yet.')).toBeInTheDocument()
    expect(await screen.findByText('No active plans.')).toBeInTheDocument()
  })
})
