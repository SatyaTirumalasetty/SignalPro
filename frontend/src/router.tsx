import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AdminRoute } from '@/components/AdminRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { AdminLayout } from '@/components/layout/AdminLayout'

import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'

import { DashboardPage } from '@/pages/DashboardPage'
import { OrdersPage } from '@/pages/trading/OrdersPage'
import { PositionsPage } from '@/pages/trading/PositionsPage'
import { PortfolioPage } from '@/pages/trading/PortfolioPage'
import { BacktestPage } from '@/pages/trading/BacktestPage'
import { AutoTradingPage } from '@/pages/trading/AutoTradingPage'
import { EngineDashboardPage } from '@/pages/trading/EngineDashboardPage'
import { MarketPage } from '@/pages/market/MarketPage'
import { WatchlistPage } from '@/pages/watchlist/WatchlistPage'
import { SymbolAnalysisPage } from '@/pages/analysis/SymbolAnalysisPage'
import { SignalsPage } from '@/pages/signals/SignalsPage'
import { SignalPerformancePage } from '@/pages/signals/SignalPerformancePage'
import { BrokersPage } from '@/pages/brokers/BrokersPage'
import { BrokerConnectedPage } from '@/pages/brokers/BrokerConnectedPage'
import { BillingPage } from '@/pages/billing/BillingPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'
import { AdminOverviewPage } from '@/pages/admin/AdminOverviewPage'
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage'
import { AdminBillingPage } from '@/pages/admin/AdminBillingPage'
import { AdminSignalsPage } from '@/pages/admin/AdminSignalsPage'
import { AdminSupportPage } from '@/pages/admin/AdminSupportPage'

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
          { path: '/trading/backtest', element: <BacktestPage /> },
          { path: '/auto-trading', element: <AutoTradingPage /> },
          { path: '/auto-trading/dashboard', element: <EngineDashboardPage /> },
          { path: '/portfolio', element: <PortfolioPage /> },
          { path: '/market', element: <MarketPage /> },
          { path: '/watchlist', element: <WatchlistPage /> },
          { path: '/analyze/:symbol', element: <SymbolAnalysisPage /> },
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
