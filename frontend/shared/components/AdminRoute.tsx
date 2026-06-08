import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@shared/hooks/useAuth'

export function AdminRoute() {
  const { user, status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <div className="flex h-screen items-center justify-center text-muted">Loading…</div>
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (user?.role !== 'admin' && user?.role !== 'super_admin') {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
