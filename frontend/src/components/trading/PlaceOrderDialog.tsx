import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import type { BrokerConnection } from '@/types/api'

export interface PlaceOrderInitialValues {
  symbol?: string
  side?: 'buy' | 'sell'
  stopLoss?: number | null
  takeProfit?: number | null
  signalId?: string
}

interface PlaceOrderDialogProps {
  open: boolean
  onClose: () => void
  initialValues?: PlaceOrderInitialValues
}

export function PlaceOrderDialog({ open, onClose, initialValues }: PlaceOrderDialogProps) {
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
  // Default to the first connected broker by deriving it during render, rather than syncing into state.
  const selectedConnectionId = brokerConnectionId || connections[0]?.id || ''

  // Pre-fill the form when the dialog opens (or reopens for a different signal). Keyed on a stable
  // signature rather than an effect, so incidental parent re-renders don't clobber in-progress edits.
  const prefillSignature = open ? `open:${initialValues?.signalId ?? ''}` : 'closed'
  const [appliedSignature, setAppliedSignature] = useState('closed')
  if (prefillSignature !== appliedSignature) {
    setAppliedSignature(prefillSignature)
    if (open) {
      setSymbol(initialValues?.symbol ?? '')
      setSide(initialValues?.side ?? 'buy')
      setStopLoss(initialValues?.stopLoss ? String(initialValues.stopLoss) : '')
      setTakeProfit(initialValues?.takeProfit ? String(initialValues.takeProfit) : '')
      setOrderType('market')
      setQuantity('')
      setPrice('')
      setError(null)
    }
  }

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
      broker_connection_id: selectedConnectionId,
      symbol: symbol.toUpperCase(),
      side,
      order_type: orderType,
      quantity: Number(quantity),
      ...(orderType === 'limit' ? { price: Number(price) } : {}),
      ...(stopLoss ? { stop_loss: Number(stopLoss) } : {}),
      ...(takeProfit ? { take_profit: Number(takeProfit) } : {}),
      ...(initialValues?.signalId ? { signal_id: initialValues.signalId } : {}),
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
        {initialValues?.signalId && (
          <p className="text-xs text-muted">
            Pre-filled from an AI signal for {initialValues.symbol}. Review the details before submitting.
          </p>
        )}
        <Select
          value={selectedConnectionId}
          onValueChange={setBrokerConnectionId}
          placeholder="Select broker connection"
          options={connections.map((conn) => ({ value: conn.id, label: `${conn.name} (${conn.broker_id})` }))}
        />
        <Input placeholder="Symbol (e.g. AAPL)" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <Select
            value={side}
            onValueChange={(value) => setSide(value as 'buy' | 'sell')}
            options={[
              { value: 'buy', label: 'Buy' },
              { value: 'sell', label: 'Sell' },
            ]}
          />
          <Select
            value={orderType}
            onValueChange={(value) => setOrderType(value as 'market' | 'limit')}
            options={[
              { value: 'market', label: 'Market' },
              { value: 'limit', label: 'Limit' },
            ]}
          />
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
