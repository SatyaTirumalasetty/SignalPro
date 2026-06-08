import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'

// Lets this remote run standalone (`npm run dev`) for local development —
// the shell loads these same exposed modules over Module Federation in production.
const OrdersPage = lazy(() => import('./pages/trading/OrdersPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const PositionsPage = lazy(() => import('./pages/trading/PositionsPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const PortfolioPage = lazy(() => import('./pages/trading/PortfolioPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const BrokersPage = lazy(() => import('./pages/brokers/BrokersPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const BrokerConnectedPage = lazy(() => import('./pages/brokers/BrokerConnectedPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const BillingPage = lazy(() => import('./pages/billing/BillingPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))

function Index() {
  return (
    <div className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">SignalPro · Trading (standalone preview)</h1>
      <p className="text-sm text-gray-500">
        This remote is normally loaded inside the shell via Module Federation.
        Pick an exposed module to preview it in isolation:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li><a className="underline text-blue-600" href="#/OrdersPage">OrdersPage</a></li>
        <li><a className="underline text-blue-600" href="#/PositionsPage">PositionsPage</a></li>
        <li><a className="underline text-blue-600" href="#/PortfolioPage">PortfolioPage</a></li>
        <li><a className="underline text-blue-600" href="#/BrokersPage">BrokersPage</a></li>
        <li><a className="underline text-blue-600" href="#/BrokerConnectedPage">BrokerConnectedPage</a></li>
        <li><a className="underline text-blue-600" href="#/BillingPage">BillingPage</a></li>
        <li><a className="underline text-blue-600" href="#/SettingsPage">SettingsPage</a></li>
      </ul>
    </div>
  )
}

export function StandalonePreview() {
  return (
    <Suspense fallback={<div className="p-8">Loading…</div>}>
      <Routes>
        <Route path="/" element={<Index />} />
          <Route path="/OrdersPage" element={<OrdersPage />} />
          <Route path="/PositionsPage" element={<PositionsPage />} />
          <Route path="/PortfolioPage" element={<PortfolioPage />} />
          <Route path="/BrokersPage" element={<BrokersPage />} />
          <Route path="/BrokerConnectedPage" element={<BrokerConnectedPage />} />
          <Route path="/BillingPage" element={<BillingPage />} />
          <Route path="/SettingsPage" element={<SettingsPage />} />
      </Routes>
    </Suspense>
  )
}
