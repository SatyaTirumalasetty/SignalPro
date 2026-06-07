import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  ListOrdered,
  Briefcase,
  LineChart,
  Sparkles,
  BarChart3,
  Plug,
  CreditCard,
  Settings,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/trading/orders', label: 'Orders', icon: ListOrdered },
  { to: '/trading/positions', label: 'Positions', icon: Briefcase },
  { to: '/portfolio', label: 'Portfolio', icon: BarChart3 },
  { to: '/market', label: 'Market', icon: LineChart },
  { to: '/signals', label: 'Signals', icon: Sparkles },
  { to: '/brokers', label: 'Brokers', icon: Plug },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40 p-4">
        <div className="mb-6 px-2 text-lg font-semibold text-foreground">SignalPro</div>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-card hover:text-foreground',
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border pt-3">
          <div className="px-2 text-xs text-muted">{user?.email}</div>
          <button
            onClick={() => logout()}
            className="mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-card hover:text-foreground cursor-pointer"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
