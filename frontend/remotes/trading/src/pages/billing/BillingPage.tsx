import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card'
import { Button } from '@shared/components/ui/button'
import { Badge } from '@shared/components/ui/badge'
import { Dialog } from '@shared/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/components/ui/table'
import { useToast } from '@shared/hooks/useToast'
import { api, getApiErrorMessage } from '@shared/lib/api'
import { formatCurrency, formatDate } from '@shared/lib/format'
import type { Invoice, PricingPlan, Subscription, UsageMetric } from '@shared/types/api'

const invoiceStatusVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  paid: 'success',
  failed: 'danger',
  refunded: 'danger',
  sent: 'default',
  draft: 'muted',
}

export function BillingPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [changingPlan, setChangingPlan] = useState<PricingPlan | null>(null)

  const subscriptionQuery = useQuery({
    queryKey: ['subscription'],
    queryFn: async () => (await api.get<{ subscription: Subscription | null }>('/subscriptions/me')).data.subscription,
  })

  const plansQuery = useQuery({
    queryKey: ['pricing-plans'],
    queryFn: async () => (await api.get<{ plans: PricingPlan[] }>('/billing/plans')).data.plans,
  })

  const usageQuery = useQuery({
    queryKey: ['billing-usage'],
    queryFn: async () => (await api.get<{ usage: UsageMetric[] }>('/billing/usage')).data.usage,
  })

  const invoicesQuery = useQuery({
    queryKey: ['invoices'],
    queryFn: async () => (await api.get<{ invoices: Invoice[] }>('/billing/invoices')).data.invoices,
  })

  const invalidateBilling = () => {
    queryClient.invalidateQueries({ queryKey: ['subscription'] })
    queryClient.invalidateQueries({ queryKey: ['billing-usage'] })
    queryClient.invalidateQueries({ queryKey: ['invoices'] })
  }

  const subscribeMutation = useMutation({
    mutationFn: (payload: { plan_id: string; billing_cycle: string }) => api.post('/subscriptions/create', payload),
    onSuccess: (res) => {
      toast(res.data?.message || 'Subscribed', 'success')
      invalidateBilling()
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const changePlanMutation = useMutation({
    mutationFn: (payload: { id: string; plan_id: string }) =>
      api.post(`/subscriptions/${payload.id}/change-plan`, { plan_id: payload.plan_id }),
    onSuccess: (res) => {
      toast(res.data?.message || 'Plan changed', 'success')
      invalidateBilling()
      setChangingPlan(null)
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const cancelMutation = useMutation({
    mutationFn: (payload: { id: string; immediately: boolean }) =>
      api.post(`/subscriptions/${payload.id}/cancel`, { immediately: payload.immediately }),
    onSuccess: (res) => {
      toast(res.data?.message || 'Subscription cancelled', 'success')
      invalidateBilling()
      setConfirmCancel(false)
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${id}/reactivate`),
    onSuccess: (res) => {
      toast(res.data?.message || 'Subscription reactivated', 'success')
      invalidateBilling()
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const subscription = subscriptionQuery.data
  const plans = plansQuery.data ?? []

  const handlePlanAction = (plan: PricingPlan) => {
    if (!subscription) {
      subscribeMutation.mutate({ plan_id: plan.id, billing_cycle: billingCycle })
    } else if (subscription.plan_id !== plan.id) {
      setChangingPlan(plan)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Billing &amp; subscription</h1>
        <p className="text-sm text-muted">Manage your plan, usage, and invoices</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current subscription</CardTitle>
        </CardHeader>
        <CardContent>
          {subscriptionQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {!subscriptionQuery.isLoading && !subscription && (
            <p className="text-sm text-muted">You don&apos;t have an active subscription. Choose a plan below to get started.</p>
          )}
          {subscription && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-semibold text-foreground">{subscription.plan_name ?? subscription.tier}</span>
                <Badge variant={subscription.status === 'active' ? 'success' : 'muted'}>{subscription.status}</Badge>
                <Badge variant="muted">{subscription.billing_cycle}</Badge>
                {subscription.cancel_at_period_end && <Badge variant="danger">Cancels at period end</Badge>}
              </div>
              <p className="text-sm text-muted">
                Current period: {formatDate(subscription.current_period_start)} – {formatDate(subscription.current_period_end)}
              </p>
              <div className="flex flex-wrap gap-2">
                {subscription.cancel_at_period_end ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => reactivateMutation.mutate(subscription.id)}
                    disabled={reactivateMutation.isPending}
                  >
                    Reactivate
                  </Button>
                ) : (
                  subscription.status === 'active' && (
                    <Button size="sm" variant="destructive" onClick={() => setConfirmCancel(true)}>
                      Cancel subscription
                    </Button>
                  )
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Plans</CardTitle>
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            <Button
              size="sm"
              variant={billingCycle === 'monthly' ? 'default' : 'ghost'}
              onClick={() => setBillingCycle('monthly')}
            >
              Monthly
            </Button>
            <Button
              size="sm"
              variant={billingCycle === 'annual' ? 'default' : 'ghost'}
              onClick={() => setBillingCycle('annual')}
            >
              Annual
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {plansQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = subscription?.plan_id === plan.id
              const price = billingCycle === 'monthly' ? plan.price_monthly : plan.price_annual
              return (
                <div key={plan.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{plan.name}</span>
                    {isCurrent && <Badge variant="success">Current plan</Badge>}
                  </div>
                  {plan.description && <p className="text-xs text-muted">{plan.description}</p>}
                  <div className="text-2xl font-semibold text-foreground">
                    {formatCurrency(Number(price))}
                    <span className="text-sm font-normal text-muted">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
                  </div>
                  <ul className="flex flex-col gap-1 text-xs text-muted">
                    <li>{plan.ai_analysis_credits} AI analysis credits/mo</li>
                    <li>{plan.max_positions} max open positions</li>
                    <li>{plan.max_watchlists} watchlists</li>
                  </ul>
                  <Button
                    size="sm"
                    className="mt-2"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={isCurrent || subscribeMutation.isPending || changePlanMutation.isPending}
                    onClick={() => handlePlanAction(plan)}
                  >
                    {isCurrent ? 'Current plan' : subscription ? 'Switch to this plan' : 'Subscribe'}
                  </Button>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage this period</CardTitle>
        </CardHeader>
        <CardContent>
          {usageQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {usageQuery.data?.length === 0 && <p className="text-sm text-muted">No usage recorded yet this period.</p>}
          {!!usageQuery.data?.length && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {usageQuery.data.map((metric) => (
                <div key={metric.metric_name} className="rounded-md border border-border p-3">
                  <div className="text-xs uppercase text-muted">{metric.metric_name.replace(/_/g, ' ')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {metric.usage_count}
                    {metric.limit_count !== null && <span className="text-sm font-normal text-muted"> / {metric.limit_count}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoicesQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {invoicesQuery.data?.length === 0 && <p className="text-sm text-muted">No invoices yet.</p>}
          {!!invoicesQuery.data?.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoicesQuery.data.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium text-foreground">{invoice.invoice_number ?? invoice.id.slice(0, 8)}</TableCell>
                    <TableCell className="text-muted">{invoice.plan_name ?? '—'}</TableCell>
                    <TableCell>{formatCurrency(Number(invoice.amount), invoice.currency)}</TableCell>
                    <TableCell>
                      <Badge variant={invoiceStatusVariant[invoice.status] ?? 'muted'}>{invoice.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted">{formatDate(invoice.payment_date ?? invoice.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel subscription">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Would you like to cancel immediately, or let your subscription run until the end of the current billing period?
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="flex-1"
              disabled={cancelMutation.isPending}
              onClick={() => subscription && cancelMutation.mutate({ id: subscription.id, immediately: false })}
            >
              Cancel at period end
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={cancelMutation.isPending}
              onClick={() => subscription && cancelMutation.mutate({ id: subscription.id, immediately: true })}
            >
              Cancel immediately
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!changingPlan} onClose={() => setChangingPlan(null)} title="Switch plan">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Switch your subscription to <strong className="text-foreground">{changingPlan?.name}</strong>?
          </p>
          <Button
            disabled={changePlanMutation.isPending}
            onClick={() => subscription && changingPlan && changePlanMutation.mutate({ id: subscription.id, plan_id: changingPlan.id })}
          >
            {changePlanMutation.isPending ? 'Switching…' : 'Confirm switch'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
