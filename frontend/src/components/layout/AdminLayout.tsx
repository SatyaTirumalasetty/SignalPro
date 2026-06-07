import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Receipt,
  TrendingUp,
  LifeBuoy,
  ArrowLeft,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/billing', label: 'Billing', icon: Receipt },
  { to: '/admin/signals', label: 'Signals', icon: TrendingUp },
  { to: '/admin/support', label: 'Support', icon: LifeBuoy },
]

export function AdminLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40 p-4">
        <div className="mb-6 px-2">
          <div className="text-lg font-semibold text-foreground">SignalPro Admin</div>
          <div className="text-xs text-muted">Operations console</div>
        </div>
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
          <NavLink
            to="/"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-card hover:text-foreground"
          >
            <ArrowLeft size={18} />
            Back to app
          </NavLink>
          <div className="mt-2 px-2 text-xs text-muted">{user?.email}</div>
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
