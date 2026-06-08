import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card'
import { Badge } from '@shared/components/ui/badge'
import { api } from '@shared/lib/api'
import { useAuth } from '@shared/hooks/useAuth'
import type { Order, PortfolioSummary, Signal } from '@shared/types/api'
import { signalBadgeVariant, formatCurrency, formatPercent } from '@shared/lib/format'

export function DashboardPage() {
  const { user } = useAuth()

  const portfolio = useQuery({
    queryKey: ['portfolio'],
    queryFn: async () => (await api.get<PortfolioSummary>('/trading/portfolio')).data,
  })

  const orders = useQuery({
    queryKey: ['orders', { limit: 5 }],
    queryFn: async () => (await api.get<{ orders: Order[] }>('/trading/orders', { params: { limit: 5 } })).data.orders,
  })

  const signals = useQuery({
    queryKey: ['signals', { limit: 5 }],
    queryFn: async () =>
      (await api.get<{ signals: Signal[] }>('/analysis/signals', { params: { limit: 5 } })).data.signals,
  })

  const summary = portfolio.data?.summary

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Welcome back{user?.full_name ? `, ${user.full_name}` : ''}</h1>
        <p className="text-sm text-muted">Here's what's happening with your portfolio</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Open positions</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-foreground">
            {summary?.open_positions ?? '—'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Closed positions</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-foreground">
            {summary?.closed_positions ?? '—'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Unrealized P&amp;L</CardTitle>
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold ${
              (summary?.unrealized_pnl ?? 0) >= 0 ? 'text-success' : 'text-danger'
            }`}
          >
            {summary ? formatCurrency(summary.unrealized_pnl) : '—'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Realized P&amp;L</CardTitle>
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold ${
              (summary?.realized_pnl ?? 0) >= 0 ? 'text-success' : 'text-danger'
            }`}
          >
            {summary ? formatCurrency(summary.realized_pnl) : '—'}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent orders</CardTitle>
            <Link to="/trading/orders" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {orders.isLoading && <p className="text-sm text-muted">Loading…</p>}
            {orders.data?.length === 0 && <p className="text-sm text-muted">No orders yet</p>}
            {orders.data?.map((order) => (
              <div key={order.id} className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{order.symbol}</span>
                <Badge variant={order.side === 'buy' ? 'success' : 'danger'}>{order.side.toUpperCase()}</Badge>
                <span className="text-muted">{order.quantity}</span>
                <Badge variant="muted">{order.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Latest signals</CardTitle>
            <Link to="/signals" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {signals.isLoading && <p className="text-sm text-muted">Loading…</p>}
            {signals.data?.length === 0 && <p className="text-sm text-muted">No signals yet</p>}
            {signals.data?.map((signal) => (
              <div key={signal.id} className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{signal.symbol}</span>
                <Badge variant={signalBadgeVariant(signal.signal_type)}>{signal.signal_type}</Badge>
                <span className="text-muted">{formatPercent(signal.confidence)} confidence</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
