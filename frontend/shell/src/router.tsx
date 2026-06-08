import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ProtectedRoute } from '@shared/components/ProtectedRoute'
import { AdminRoute } from '@shared/components/AdminRoute'
import { AppLayout } from '@shared/components/layout/AppLayout'
import { AdminLayout } from '@shared/components/layout/AdminLayout'
import { remotePage } from '@/lib/remoteLazy'

import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { DashboardPage } from '@/pages/DashboardPage'

// ── Trading remote ────────────────────────────────────────────────────────────
const OrdersPage = remotePage(() => import('trading_remote/OrdersPage'), (m) => m.OrdersPage)
const PositionsPage = remotePage(() => import('trading_remote/PositionsPage'), (m) => m.PositionsPage)
const PortfolioPage = remotePage(() => import('trading_remote/PortfolioPage'), (m) => m.PortfolioPage)
const BrokersPage = remotePage(() => import('trading_remote/BrokersPage'), (m) => m.BrokersPage)
const BrokerConnectedPage = remotePage(() => import('trading_remote/BrokerConnectedPage'), (m) => m.BrokerConnectedPage)
const BillingPage = remotePage(() => import('trading_remote/BillingPage'), (m) => m.BillingPage)
const SettingsPage = remotePage(() => import('trading_remote/SettingsPage'), (m) => m.SettingsPage)

// ── Market remote ─────────────────────────────────────────────────────────────
const MarketPage = remotePage(() => import('market_remote/MarketPage'), (m) => m.MarketPage)
const SignalsPage = remotePage(() => import('market_remote/SignalsPage'), (m) => m.SignalsPage)
const SignalPerformancePage = remotePage(() => import('market_remote/SignalPerformancePage'), (m) => m.SignalPerformancePage)

// ── Admin remote ──────────────────────────────────────────────────────────────
const AdminOverviewPage = remotePage(() => import('admin_remote/AdminOverviewPage'), (m) => m.AdminOverviewPage)
const AdminUsersPage = remotePage(() => import('admin_remote/AdminUsersPage'), (m) => m.AdminUsersPage)
const AdminBillingPage = remotePage(() => import('admin_remote/AdminBillingPage'), (m) => m.AdminBillingPage)
const AdminSignalsPage = remotePage(() => import('admin_remote/AdminSignalsPage'), (m) => m.AdminSignalsPage)
const AdminSupportPage = remotePage(() => import('admin_remote/AdminSupportPage'), (m) => m.AdminSupportPage)

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/brokers/connected', element: <BrokerConnectedPage /> },
      {
        element: <AdminRoute />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { path: '/admin', element: <AdminOverviewPage /> },
              { path: '/admin/users', element: <AdminUsersPage /> },
              { path: '/admin/billing', element: <AdminBillingPage /> },
              { path: '/admin/signals', element: <AdminSignalsPage /> },
              { path: '/admin/support', element: <AdminSupportPage /> },
            ],
          },
        ],
      },
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/trading/orders', element: <OrdersPage /> },
          { path: '/trading/positions', element: <PositionsPage /> },
          { path: '/portfolio', element: <PortfolioPage /> },
          { path: '/market', element: <MarketPage /> },
          { path: '/signals', element: <SignalsPage /> },
          { path: '/signals/performance', element: <SignalPerformancePage /> },
          { path: '/brokers', element: <BrokersPage /> },
          { path: '/billing', element: <BillingPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
