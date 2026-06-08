import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'

// Lets this remote run standalone (`npm run dev`) for local development —
// the shell loads these same exposed modules over Module Federation in production.
const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const AdminBillingPage = lazy(() => import('./pages/admin/AdminBillingPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const AdminSignalsPage = lazy(() => import('./pages/admin/AdminSignalsPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const AdminSupportPage = lazy(() => import('./pages/admin/AdminSupportPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))

function Index() {
  return (
    <div className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">SignalPro · Admin (standalone preview)</h1>
      <p className="text-sm text-gray-500">
        This remote is normally loaded inside the shell via Module Federation.
        Pick an exposed module to preview it in isolation:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li><a className="underline text-blue-600" href="#/AdminOverviewPage">AdminOverviewPage</a></li>
        <li><a className="underline text-blue-600" href="#/AdminUsersPage">AdminUsersPage</a></li>
        <li><a className="underline text-blue-600" href="#/AdminBillingPage">AdminBillingPage</a></li>
        <li><a className="underline text-blue-600" href="#/AdminSignalsPage">AdminSignalsPage</a></li>
        <li><a className="underline text-blue-600" href="#/AdminSupportPage">AdminSupportPage</a></li>
      </ul>
    </div>
  )
}

export function StandalonePreview() {
  return (
    <Suspense fallback={<div className="p-8">Loading…</div>}>
      <Routes>
        <Route path="/" element={<Index />} />
          <Route path="/AdminOverviewPage" element={<AdminOverviewPage />} />
          <Route path="/AdminUsersPage" element={<AdminUsersPage />} />
          <Route path="/AdminBillingPage" element={<AdminBillingPage />} />
          <Route path="/AdminSignalsPage" element={<AdminSignalsPage />} />
          <Route path="/AdminSupportPage" element={<AdminSupportPage />} />
      </Routes>
    </Suspense>
  )
}
