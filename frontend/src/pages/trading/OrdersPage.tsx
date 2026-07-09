import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PlaceOrderDialog } from '@/components/trading/PlaceOrderDialog'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { Order } from '@/types/api'

const statusVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  filled: 'success',
  executed: 'success',
  cancelled: 'danger',
  rejected: 'danger',
  pending: 'default',
}

export function OrdersPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const ordersQuery = useQuery({
    queryKey: ['orders'],
    queryFn: async () => (await api.get<{ orders: Order[] }>('/trading/orders')).data.orders,
  })

  const orders = [...(ordersQuery.data ?? [])].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    return sortDirection === 'asc' ? diff : -diff
  })

  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => api.delete(`/trading/orders/${orderId}`),
    onSuccess: () => {
      toast('Order cancelled', 'success')
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Orders</h1>
          <p className="text-sm text-muted">Place and manage your trade orders</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>Place order</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order history</CardTitle>
        </CardHeader>
        <CardContent>
          {ordersQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {ordersQuery.data?.length === 0 && <p className="text-sm text-muted">No orders yet.</p>}
          {!!ordersQuery.data?.length && (
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>SL / TP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead
                    sortDirection={sortDirection}
                    onSort={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  >
                    Created
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium text-foreground">{order.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={order.side === 'buy' ? 'success' : 'danger'}>{order.side.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-muted">{order.order_type}</TableCell>
                    <TableCell>{formatNumber(order.quantity)}</TableCell>
                    <TableCell>{order.price ? formatNumber(order.price) : 'Market'}</TableCell>
                    <TableCell className="text-muted">
                      {order.stop_loss || order.take_profit
                        ? `${order.stop_loss ? formatNumber(order.stop_loss) : '—'} / ${order.take_profit ? formatNumber(order.take_profit) : '—'}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[order.status?.toLowerCase()] ?? 'muted'}>{order.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted">{formatDate(order.created_at)}</TableCell>
                    <TableCell>
                      {['pending', 'open', 'partially_filled'].includes(order.status?.toLowerCase() ?? '') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => cancelMutation.mutate(order.id)}
                          disabled={cancelMutation.isPending}
                        >
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PlaceOrderDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}
