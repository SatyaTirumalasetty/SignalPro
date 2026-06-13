import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { BrokerConnection, Order } from '@/types/api'

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

  const ordersQuery = useQuery({
    queryKey: ['orders'],
    queryFn: async () => (await api.get<{ orders: Order[] }>('/trading/orders')).data.orders,
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
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>SL / TP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersQuery.data.map((order) => (
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
                      {order.status?.toLowerCase() === 'pending' && (
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

function PlaceOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [brokerConnectionId, setBrokerConnectionId] = useState('')
  const [symbol, setSymbol] = useState('')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [error, setError] = useState<string | null>(null)

  const connectionsQuery = useQuery({
    queryKey: ['broker-connections'],
    queryFn: async () => (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections,
    enabled: open,
  })
  const connections = (connectionsQuery.data ?? []).filter((c) => c.status === 'connected')

  useEffect(() => {
    if (!brokerConnectionId && connections.length > 0) setBrokerConnectionId(connections[0].id)
  }, [connections, brokerConnectionId])

  const placeMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/trading/orders', payload),
    onSuccess: () => {
      toast('Order placed', 'success')
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      setSymbol('')
      setQuantity('')
      setPrice('')
      setStopLoss('')
      setTakeProfit('')
      onClose()
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    placeMutation.mutate({
      broker_connection_id: brokerConnectionId,
      symbol: symbol.toUpperCase(),
      side,
      order_type: orderType,
      quantity: Number(quantity),
      ...(orderType === 'limit' ? { price: Number(price) } : {}),
      ...(stopLoss ? { stop_loss: Number(stopLoss) } : {}),
      ...(takeProfit ? { take_profit: Number(takeProfit) } : {}),
    })
  }

  if (open && !connectionsQuery.isLoading && connections.length === 0) {
    return (
      <Dialog open={open} onClose={onClose} title="Place order">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            You need an active broker connection before you can place orders.
          </p>
          <Link
            to="/brokers"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Connect a broker
          </Link>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} title="Place order">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <select
          value={brokerConnectionId}
          onChange={(e) => setBrokerConnectionId(e.target.value)}
          className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          required
        >
          <option value="" disabled>Select broker connection</option>
          {connections.map((conn) => (
            <option key={conn.id} value={conn.id}>{conn.name} ({conn.broker_id})</option>
          ))}
        </select>
        <Input placeholder="Symbol (e.g. AAPL)" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as 'market' | 'limit')}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </div>
        <Input
          type="number"
          placeholder="Quantity"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          min="0"
          step="any"
          required
        />
        {orderType === 'limit' && (
          <Input
            type="number"
            placeholder="Limit price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            min="0"
            step="any"
            required
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="number"
            placeholder="Stop loss (optional)"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            min="0"
            step="any"
          />
          <Input
            type="number"
            placeholder="Take profit (optional)"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            min="0"
            step="any"
          />
        </div>
        <p className="text-xs text-muted">
          Setting a stop loss enables risk-based position sizing and submits a bracket order to the broker.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={placeMutation.isPending}>
          {placeMutation.isPending ? 'Placing…' : 'Place order'}
        </Button>
      </form>
    </Dialog>
  )
}
