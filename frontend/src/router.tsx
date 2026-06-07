import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'

import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'

import { DashboardPage } from '@/pages/DashboardPage'
import { OrdersPage } from '@/pages/trading/OrdersPage'
import { PositionsPage } from '@/pages/trading/PositionsPage'
import { PortfolioPage } from '@/pages/trading/PortfolioPage'
import { MarketPage } from '@/pages/market/MarketPage'
import { SignalsPage } from '@/pages/signals/SignalsPage'
import { SignalPerformancePage } from '@/pages/signals/SignalPerformancePage'
import { BrokersPage } from '@/pages/brokers/BrokersPage'
import { BrokerConnectedPage } from '@/pages/brokers/BrokerConnectedPage'
import { BillingPage } from '@/pages/billing/BillingPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'

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
