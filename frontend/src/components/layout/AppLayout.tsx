import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import * as RadixDialog from '@radix-ui/react-dialog'
import {
  LayoutDashboard,
  ListOrdered,
  Briefcase,
  LineChart,
  Sparkles,
  BarChart3,
  FlaskConical,
  Plug,
  CreditCard,
  Settings,
  ShieldCheck,
  LogOut,
  Bot,
  Activity,
  Menu,
  ChevronDown,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/trading/orders', label: 'Orders', icon: ListOrdered },
  { to: '/trading/positions', label: 'Positions', icon: Briefcase },
  { to: '/trading/backtest', label: 'Backtest', icon: FlaskConical },
  { to: '/auto-trading', label: 'Auto Trading', icon: Bot },
  { to: '/auto-trading/dashboard', label: 'Engine Dashboard', icon: Activity },
  { to: '/portfolio', label: 'Portfolio', icon: BarChart3 },
  { to: '/market', label: 'Market', icon: LineChart },
  { to: '/signals', label: 'Signals', icon: Sparkles },
  { to: '/brokers', label: 'Brokers', icon: Plug },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function NavLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1">
      {navItems.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
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
      {isAdmin && (
        <NavLink
          to="/admin"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-card hover:text-foreground',
            )
          }
        >
          <ShieldCheck size={18} />
          Admin
        </NavLink>
      )}
    </nav>
  )
}

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/40 px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-md p-2 text-muted hover:bg-card hover:text-foreground cursor-pointer md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <span className="text-lg font-semibold text-foreground">SignalPro</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-card hover:text-foreground cursor-pointer outline-none">
            <span className="max-w-[10rem] truncate">{user?.email}</span>
            <ChevronDown size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings size={16} />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()}>
              <LogOut size={16} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 p-4 md:flex">
          <NavLinks isAdmin={isAdmin} />
        </aside>

        <RadixDialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 md:hidden" />
            <RadixDialog.Content
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card p-4 outline-none md:hidden"
            >
              <RadixDialog.Title className="mb-6 px-2 text-lg font-semibold text-foreground">
                SignalPro
              </RadixDialog.Title>
              <NavLinks isAdmin={isAdmin} onNavigate={() => setMobileNavOpen(false)} />
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
