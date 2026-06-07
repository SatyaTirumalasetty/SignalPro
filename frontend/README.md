# SignalPro Frontend

Customer-facing React app for SignalPro Enterprise — auth, dashboard, trading, portfolio, market data, and AI signals.

## Stack

React 18 + TypeScript + Vite + Tailwind CSS + TanStack Query + Axios + React Router + lightweight-charts.

## Setup

```bash
cd frontend
npm install
cp .env.example .env   # set VITE_API_BASE_URL if the backend isn't on localhost:3001
npm run dev
```

The app runs at `http://localhost:5173` and expects the backend (see `../backend`) to be running at the URL configured in `VITE_API_BASE_URL` (default `http://localhost:3001`). Make sure the backend's `FRONTEND_URL` env var matches this app's origin so CORS allows requests.

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build locally
- `npm run lint` — run ESLint

## Structure

- `src/lib/` — API client (with auth-refresh interceptor), query client, formatting helpers
- `src/contexts/` + `src/hooks/` — auth and toast contexts/hooks
- `src/components/` — shared UI primitives (`ui/`), layout shells, the live-price chart
- `src/pages/` — route-level pages, grouped by feature area (`auth/`, `trading/`, `market/`, `signals/`)
- `src/router.tsx` — route table and the `ProtectedRoute` auth guard

## Status

This covers the core "golden path": register → verify email → sign in (incl. 2FA) → dashboard → place/cancel orders → manage positions → view portfolio → search market data & live prices → generate and review AI signals.

Not yet implemented (planned as a follow-up): broker connections, billing/subscriptions, and account settings (profile, 2FA setup, sessions, API keys).
