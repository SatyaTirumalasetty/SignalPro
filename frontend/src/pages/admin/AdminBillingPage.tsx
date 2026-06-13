import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import type { AdminMrrPoint, AdminRevenueByPlan } from '@/types/api'

const tierVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  starter: 'muted',
  pro: 'default',
  enterprise: 'success',
}

export function AdminBillingPage() {
  const mrrQuery = useQuery({
    queryKey: ['admin-mrr'],
    queryFn: async () => (await api.get<{ current_mrr: number; monthly_breakdown: AdminMrrPoint[] }>('/admin/billing/mrr')).data,
  })

  const revenueQuery = useQuery({
    queryKey: ['admin-revenue-by-plan'],
    queryFn: async () => (await api.get<{ plans: AdminRevenueByPlan[] }>('/admin/billing/revenue-by-plan')).data.plans,
  })

  const mrr = mrrQuery.data
  const plans = revenueQuery.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Billing &amp; revenue</h1>
        <p className="text-sm text-muted">Monthly recurring revenue and plan breakdowns</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current MRR</CardTitle>
        </CardHeader>
        <CardContent>
          {mrrQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {mrr && <p className="text-3xl font-semibold text-foreground">{formatCurrency(mrr.current_mrr)}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {!mrr?.monthly_breakdown?.length && <p className="text-sm text-muted">No billing history yet.</p>}
          {!!mrr?.monthly_breakdown?.length && (
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>MRR</TableHead>
                  <TableHead>New subscriptions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mrr.monthly_breakdown.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-foreground">{formatDate(row.month)}</TableCell>
                    <TableCell className="text-muted">{formatCurrency(Number(row.mrr))}</TableCell>
                    <TableCell className="text-muted">{formatNumber(Number(row.new_subs), 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by plan</CardTitle>
        </CardHeader>
        <CardContent>
          {revenueQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {!revenueQuery.isLoading && plans.length === 0 && <p className="text-sm text-muted">No active plans.</p>}
          {!!plans.length && (
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Subscribers</TableHead>
                  <TableHead>MRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant={tierVariant[p.tier] ?? 'default'}>{p.tier}</Badge>
                    </TableCell>
                    <TableCell className="text-muted">{formatNumber(Number(p.subscriber_count), 0)}</TableCell>
                    <TableCell className="text-muted">{formatCurrency(Number(p.mrr))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
