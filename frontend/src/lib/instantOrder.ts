import { api } from '@/lib/api'
import { sizeByRisk } from '@/lib/positionSize'
import type { Signal } from '@/types/api'

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
