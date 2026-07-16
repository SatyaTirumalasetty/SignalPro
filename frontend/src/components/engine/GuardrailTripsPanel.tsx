import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import type { EngineGuardrailTrips } from '@/types/api'

export function GuardrailTripsPanel() {
  const { data } = useQuery({
    queryKey: ['engine-guardrail-trips'],
    queryFn: async () => (await api.get<EngineGuardrailTrips>('/auto-trading/guardrail-trips')).data,
  })
  const max = (data?.trips ?? []).reduce((m, t) => Math.max(m, t.count), 0)

  return (
    <Card>
      <CardHeader><CardTitle>Guardrail trips</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted">Cycles where the engine analyzed but code declined to act, by reason. The safety layer at work.</p>
        {!data?.sufficient && (
          <p className="text-sm text-muted">Needs at least {data?.min_required ?? 20} cycles to be meaningful ({data?.total_runs ?? 0} so far).</p>
        )}
        {data?.sufficient && data.trips.map((t) => (
          <div key={t.action} className="flex items-center gap-3 text-sm">
            <span className="w-56 shrink-0 text-right text-muted">{t.action}</span>
            <span className="h-2.5 rounded bg-primary" style={{ width: `${max > 0 ? (t.count / max) * 100 : 0}%` }} />
            <span className="w-10 text-foreground">{t.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
