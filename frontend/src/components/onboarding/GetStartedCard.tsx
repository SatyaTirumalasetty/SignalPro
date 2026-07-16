import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import type { AutoTradingSettings, BrokerConnection } from '@/types/api'

const DISMISS_KEY = 'getStarted.dismissed'

interface Step {
  label: string
  to: string
  done: boolean
  note?: string
}

export function GetStartedCard() {
  const [dismissed, setDismissed] = useLocalStorage(DISMISS_KEY)

  const connectionsQuery = useQuery({
    queryKey: ['broker-connections'],
    queryFn: async () =>
      (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections,
  })
  const settingsQuery = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () =>
      (await api.get<{ settings: AutoTradingSettings }>('/auto-trading/settings')).data.settings,
  })

  // Wait for both reads before deciding visibility — avoids a flash of the card.
  if (connectionsQuery.isLoading || settingsQuery.isLoading) return null

  const connections = connectionsQuery.data ?? []
  const settings = settingsQuery.data ?? null

  const brokerConnected = connections.some((c) => c.status === 'connected')
  const autoConfigured = !!settings?.broker_connection_id && (settings?.symbols.length ?? 0) > 0
  const engineEnabled = settings?.enabled === true

  const steps: Step[] = [
    {
      label: 'Connect a broker',
      to: '/brokers',
      done: brokerConnected,
      note: 'Fund your account with your broker to trade for real.',
    },
    { label: 'Configure Auto Trading', to: '/auto-trading', done: autoConfigured },
    { label: 'Enable the engine', to: '/auto-trading', done: engineEnabled },
  ]

  const completedCount = steps.filter((s) => s.done).length
  const allDone = completedCount === steps.length

  if (allDone || dismissed) return null

  const firstIncompleteIndex = steps.findIndex((s) => !s.done)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Get started</CardTitle>
        <span className="text-xs text-muted">
          {completedCount} of {steps.length}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {steps.map((step, i) => {
          const current = i === firstIncompleteIndex
          return (
            <div key={step.label} className="flex flex-col">
              <Link
                to={step.to}
                className={cn(
                  'group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                  step.done
                    ? 'text-muted'
                    : current
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:bg-elevated',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs',
                    step.done
                      ? 'border-success text-success'
                      : current
                        ? 'border-primary text-primary'
                        : 'border-border text-muted',
                  )}
                >
                  {step.done ? <Check size={14} /> : i + 1}
                </span>
                <span className="flex-1">{step.label}</span>
                {current && <ArrowRight size={16} className="shrink-0" />}
              </Link>
              {step.note && !step.done && <p className="pl-10 text-xs text-muted">{step.note}</p>}
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setDismissed('1')}
          className="self-start px-2 pt-1 text-xs text-muted hover:text-foreground cursor-pointer"
        >
          Dismiss
        </button>
      </CardContent>
    </Card>
  )
}
