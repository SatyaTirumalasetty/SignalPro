import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { sizeByRisk } from '@/lib/positionSize'
import type { BrokerConnection, Signal } from '@/types/api'

interface Prefs { trading?: { instant_orders?: boolean }; [k: string]: unknown }

export async function placeInstantOrder({ symbol, signal, connectionId, equity, riskPct }: {
  symbol: string; signal: Signal; connectionId: string; equity: number; riskPct: number
}) {
  const entry = signal.entry_price ?? 0
  const stop = signal.stop_loss ?? 0
  const quantity = sizeByRisk({ equity, riskPct, entry, stop })
  if (quantity <= 0) throw new Error('Could not size order from risk settings')
  const res = await api.post<{ order: { id: string } }>('/trading/orders', {
    broker_connection_id: connectionId,
    symbol,
    side: signal.signal_type === 'sell' ? 'sell' : 'buy',
    order_type: 'market',
    quantity,
    stop_loss: signal.stop_loss,
    take_profit: signal.take_profit,
    signal_id: signal.id,
  })
  return { orderId: res.data.order.id }
}

export function TradeTicket({ symbol, signal, currentPrice, armed = false }: {
  symbol: string; signal?: Signal | null; currentPrice?: number | null; armed?: boolean
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const connectionsQuery = useQuery({
    queryKey: ['broker-connections'],
    queryFn: async () => (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections,
  })
  const connected = (connectionsQuery.data ?? []).filter((c) => c.status === 'connected')
  const [connectionId, setConnectionId] = useState('')
  useEffect(() => {
    if (!connectionId && connected.length) setConnectionId(connected[0].id)
  }, [connected, connectionId])

  const accountQuery = useQuery({
    queryKey: ['broker-account', connectionId],
    queryFn: async () => (await api.get<{ account: { funds?: { equity?: number } } }>(`/brokers/connections/${connectionId}/accounts`)).data.account,
    enabled: !!connectionId,
  })
  const settingsQuery = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () => (await api.get<{ settings: { risk_per_trade_pct: number } }>('/auto-trading/settings')).data.settings,
  })
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<{ user: { preferences?: Prefs } }>('/users/me')).data,
  })

  const equity = accountQuery.data?.funds?.equity ?? null
  const riskPct = settingsQuery.data?.risk_per_trade_pct ?? 0.01

  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [quantity, setQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [seeded, setSeeded] = useState(false)

  // Seed from the signal once sizing inputs are available
  useEffect(() => {
    if (seeded || !signal) return
    setSide(signal.signal_type === 'sell' ? 'sell' : 'buy')
    if (signal.stop_loss != null) setStopLoss(String(signal.stop_loss))
    if (signal.take_profit != null) setTakeProfit(String(signal.take_profit))
    const entry = signal.entry_price ?? currentPrice ?? 0
    if (equity != null && signal.stop_loss != null && entry) {
      const qty = sizeByRisk({ equity, riskPct, entry, stop: signal.stop_loss })
      if (qty > 0) setQuantity(String(qty))
      setSeeded(true)
    } else if (accountQuery.isError) {
      setSeeded(true) // give up seeding quantity; leave blank
    }
  }, [signal, equity, riskPct, currentPrice, seeded, accountQuery.isError])

  const instantOrders = Boolean(meQuery.data?.user.preferences?.trading?.instant_orders)
  const toggleInstant = async (checked: boolean) => {
    const prefs = { ...(meQuery.data?.user.preferences ?? {}) }
    prefs.trading = { ...(prefs.trading ?? {}), instant_orders: checked }
    await api.put('/users/me', { preferences: prefs })
    void queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  const orderMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/trading/orders', payload),
    onSuccess: () => {
      toast('Order placed', 'success')
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const submit = () => {
    const payload: Record<string, unknown> = {
      broker_connection_id: connectionId,
      symbol,
      side,
      order_type: orderType,
      quantity: Number(quantity),
    }
    if (orderType === 'limit' && limitPrice) payload.price = Number(limitPrice)
    if (stopLoss) payload.stop_loss = Number(stopLoss)
    if (takeProfit) payload.take_profit = Number(takeProfit)
    if (signal?.id) payload.signal_id = signal.id
    orderMutation.mutate(payload)
  }

  return (
    <Card className={armed ? 'border-primary' : undefined}>
      <CardHeader>
        <CardTitle>Trade {symbol}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button type="button" data-active={side === 'buy'} variant={side === 'buy' ? 'default' : 'outline'} onClick={() => setSide('buy')} className="flex-1">Buy</Button>
          <Button type="button" data-active={side === 'sell'} variant={side === 'sell' ? 'default' : 'outline'} onClick={() => setSide('sell')} className="flex-1">Sell</Button>
        </div>

        <Select
          value={connectionId}
          onValueChange={setConnectionId}
          placeholder="Broker connection"
          options={connected.map((c) => ({ value: c.id, label: `${c.name} (${c.broker_id})` }))}
        />

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Quantity
            <Input aria-label="quantity" type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Order type
            <Select value={orderType} onValueChange={(v) => setOrderType(v as 'market' | 'limit')} options={[{ value: 'market', label: 'Market' }, { value: 'limit', label: 'Limit' }]} />
          </label>
          {orderType === 'limit' && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Limit price
              <Input aria-label="limit price" type="number" step="any" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Stop loss
            <Input aria-label="stop loss" type="number" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Take profit
            <Input aria-label="take profit" type="number" step="any" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
          </label>
        </div>

        {accountQuery.isError && (
          <p className="text-xs text-danger">Couldn't size from account equity — enter a quantity manually.</p>
        )}
        {equity != null && quantity && Number(quantity) > 0 && (currentPrice ?? signal?.entry_price) != null && (
          <p className="text-xs text-muted">
            Est. {side === 'buy' ? 'cost' : 'proceeds'}: ${(Number(quantity) * (currentPrice ?? signal!.entry_price!)).toFixed(2)} · Equity: ${equity.toFixed(0)}
          </p>
        )}

        <Button type="button" onClick={submit} disabled={orderMutation.isPending || !connectionId || !quantity}>
          {orderMutation.isPending ? 'Placing…' : `Confirm ${side}`}
        </Button>

        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-muted">Instant orders from signal cards</span>
          <Switch aria-label="Instant orders from signal cards" checked={instantOrders} onCheckedChange={(c) => void toggleInstant(c)} />
        </div>
      </CardContent>
    </Card>
  )
}
