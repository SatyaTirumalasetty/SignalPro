import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { prefetchCandles } from '@/hooks/useCandles'
import { placeInstantOrder } from '@/components/analysis/TradeTicket'
import type { BrokerConnection, Signal } from '@/types/api'

export function SignalTradeButtons({ signal }: { signal: Signal }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Prime the cache so the instant-mode check below is usually a cache hit,
  // but always resolve it fresh at click time to avoid racing initial render.
  useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<{ user: { preferences?: { trading?: { instant_orders?: boolean } } } }>('/users/me')).data,
    staleTime: 60_000,
  })

  const go = () => navigate(`/analyze/${signal.symbol}?signal=${signal.id}&arm=1`)

  const fire = async (side: 'buy' | 'sell') => {
    const me = await queryClient.fetchQuery({
      queryKey: ['me'],
      queryFn: async () => (await api.get<{ user: { preferences?: { trading?: { instant_orders?: boolean } } } }>('/users/me')).data,
      staleTime: 60_000,
    })
    const instant = Boolean(me?.user?.preferences?.trading?.instant_orders)
    if (!instant) return go()
    try {
      const connections = (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections
      const conn = connections.find((c) => c.status === 'connected')
      if (!conn) throw new Error('No connected broker')
      const account = (await api.get<{ account: { funds?: { equity?: number } } }>(`/brokers/connections/${conn.id}/accounts`)).data.account
      const settings = (await api.get<{ settings: { risk_per_trade_pct: number } }>('/auto-trading/settings')).data.settings
      const { orderId } = await placeInstantOrder({
        symbol: signal.symbol,
        signal: { ...signal, signal_type: side },
        connectionId: conn.id,
        equity: account.funds?.equity ?? 0,
        riskPct: settings.risk_per_trade_pct ?? 0.01,
      })
      toast(`Order placed (${orderId.slice(0, 8)}…)`, 'success')
    } catch (err) {
      toast(getApiErrorMessage(err), 'error')
    }
  }

  const prefetch = () => prefetchCandles(queryClient, signal.symbol)
  const suggested = signal.signal_type === 'sell' ? 'sell' : 'buy'

  return (
    <span className="flex gap-1.5" onMouseEnter={prefetch}>
      <Button type="button" size="sm" variant={suggested === 'buy' ? 'default' : 'outline'} onClick={() => void fire('buy')}>
        Buy
      </Button>
      <Button type="button" size="sm" variant={suggested === 'sell' ? 'default' : 'outline'} onClick={() => void fire('sell')}>
        Sell
      </Button>
    </span>
  )
}
