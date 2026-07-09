import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { BillingPage } from './BillingPage'
import { api } from '@/lib/api'
import type { Invoice, PricingPlan, Subscription, UsageMetric } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error'),
}))

const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: toastFn }),
}))

const subscription: Subscription = {
  id: 'sub1',
  user_id: 'u1',
  plan_id: 'pro',
  status: 'active',
  billing_cycle: 'monthly',
  current_period_start: '2026-06-01T00:00:00.000Z',
  current_period_end: '2026-07-01T00:00:00.000Z',
  cancel_at_period_end: false,
  payment_method: null,
  last_payment_id: null,
  auto_renew: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  cancelled_at: null,
  plan_name: 'Pro',
  tier: 'pro',
}

const plans: PricingPlan[] = [
  {
    id: 'pro',
    name: 'Pro',
    tier: 'pro',
    description: 'For active traders',
    price_monthly: 29,
    price_annual: 290,
    ai_analysis_credits: 100,
    max_positions: 20,
    max_watchlists: 5,
    max_api_calls_per_minute: 60,
    features: {},
    active: true,
  },
  {
    id: 'elite',
    name: 'Elite',
    tier: 'elite',
    description: 'For pros',
    price_monthly: 99,
    price_annual: 990,
    ai_analysis_credits: 1000,
    max_positions: 100,
    max_watchlists: 20,
    max_api_calls_per_minute: 300,
    features: {},
    active: true,
  },
]

const usage: UsageMetric[] = [{ metric_name: 'ai_analysis', usage_count: 10, limit_count: 100 }]

const invoices: Invoice[] = [
  {
    id: 'inv-00000001',
    user_id: 'u1',
    subscription_id: 'sub1',
    amount: 29,
    currency: 'usd',
    status: 'paid',
    payment_date: '2026-06-01T00:00:00.000Z',
    due_date: null,
    invoice_number: 'INV-001',
    pdf_url: null,
    metadata: null,
    created_at: '2026-06-01T00:00:00.000Z',
  },
]

function mockApi(overrides: { subscription?: Subscription | null; plans?: PricingPlan[]; usage?: UsageMetric[]; invoices?: Invoice[] } = {}) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/subscriptions/me') return Promise.resolve({ data: { subscription: overrides.subscription !== undefined ? overrides.subscription : subscription } })
    if (url === '/billing/plans') return Promise.resolve({ data: { plans: overrides.plans ?? plans } })
    if (url === '/billing/usage') return Promise.resolve({ data: { usage: overrides.usage ?? usage } })
    if (url === '/billing/invoices') return Promise.resolve({ data: { invoices: overrides.invoices ?? invoices } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BillingPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BillingPage', () => {
  test('renders subscription, plans, usage, and invoices', async () => {
    mockApi()
    renderPage()

    expect((await screen.findAllByText('Pro')).length).toBeGreaterThan(0)
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('Elite')).toBeInTheDocument()
    expect(screen.getByText('ai analysis')).toBeInTheDocument()
    expect(screen.getByText('INV-001')).toBeInTheDocument()
    expect(screen.getByText('paid')).toBeInTheDocument()
  })

  test('shows subscribe prompt when there is no subscription', async () => {
    mockApi({ subscription: null })
    renderPage()

    expect(await screen.findByText("You don't have an active subscription. Choose a plan below to get started.")).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Subscribe' }).length).toBeGreaterThan(0)
  })

  test('cancels subscription at period end', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: { message: 'Subscription cancelled' } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel at period end' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/subscriptions/sub1/cancel', { immediately: false }))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Subscription cancelled', 'success'))
  })

  test('switches to a different plan', async () => {
    mockApi()
    ;(api.post as Mock).mockResolvedValue({ data: { message: 'Plan changed' } })
    renderPage()

    await screen.findAllByText('Pro')
    await userEvent.click(screen.getByRole('button', { name: 'Switch to this plan' }))
    expect(await screen.findByText('Switch plan')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/subscriptions/sub1/change-plan', { plan_id: 'elite' }))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Plan changed', 'success'))
  })

  test('shows empty states for usage and invoices', async () => {
    mockApi({ usage: [], invoices: [] })
    renderPage()

    expect(await screen.findByText('No usage recorded yet this period.')).toBeInTheDocument()
    expect(await screen.findByText('No invoices yet.')).toBeInTheDocument()
  })
})
