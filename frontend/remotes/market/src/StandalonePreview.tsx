import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'

// Lets this remote run standalone (`npm run dev`) for local development —
// the shell loads these same exposed modules over Module Federation in production.
const MarketPage = lazy(() => import('./pages/market/MarketPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const SignalsPage = lazy(() => import('./pages/signals/SignalsPage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))
const SignalPerformancePage = lazy(() => import('./pages/signals/SignalPerformancePage').then((m) => ({ default: Object.values(m)[0] as React.ComponentType })))

function Index() {
  return (
    <div className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">SignalPro · Market (standalone preview)</h1>
      <p className="text-sm text-gray-500">
        This remote is normally loaded inside the shell via Module Federation.
        Pick an exposed module to preview it in isolation:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li><a className="underline text-blue-600" href="#/MarketPage">MarketPage</a></li>
        <li><a className="underline text-blue-600" href="#/SignalsPage">SignalsPage</a></li>
        <li><a className="underline text-blue-600" href="#/SignalPerformancePage">SignalPerformancePage</a></li>
      </ul>
    </div>
  )
}

export function StandalonePreview() {
  return (
    <Suspense fallback={<div className="p-8">Loading…</div>}>
      <Routes>
        <Route path="/" element={<Index />} />
          <Route path="/MarketPage" element={<MarketPage />} />
          <Route path="/SignalsPage" element={<SignalsPage />} />
          <Route path="/SignalPerformancePage" element={<SignalPerformancePage />} />
      </Routes>
    </Suspense>
  )
}
