import { Link } from 'react-router-dom'
import { HealthStrip } from '@/components/engine/HealthStrip'

export function EngineDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Engine dashboard</h1>
          <p className="text-sm text-muted">How the autonomous engine is performing and behaving. P&amp;L is attributed to the engine by symbol.</p>
        </div>
        <Link to="/auto-trading" className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground">
          Settings
        </Link>
      </div>
      <HealthStrip />
    </div>
  )
}
