# SignalPro Frontend

Customer-facing React app for SignalPro Enterprise — auth, dashboard, trading, portfolio, market data, and AI signals.

Built as a **micro-frontend** using [Module Federation](https://module-federation.io/) (`@module-federation/vite`): a host **shell** loads independently-deployable **remotes** at runtime.

## Stack

React 19 + TypeScript + Vite + Module Federation + Tailwind CSS + TanStack Query + Axios + React Router + the embedded TradingView Advanced Chart widget.

## Apps

| App | Workspace | Dev port | Responsibilities |
| --- | --- | --- | --- |
| **shell** | `shell` | 5173 | Host app — auth, layout, routing, dashboard; loads the remotes below |
| **trading_remote** | `remotes/trading` | 5174 | Orders, positions, portfolio, brokers, billing, settings |
| **market_remote** | `remotes/market` | 5175 | Market data, AI signals, TradingView charts |
| **admin_remote** | `remotes/admin` | 5176 | Admin overview, users, billing, signals, support |

`shared/` (not its own workspace) holds code shared across all apps via the `@shared/*` path alias: API client, query client, auth/toast contexts and hooks, UI primitives, layout shells, formatting helpers, and the Tailwind theme.

## Setup

```bash
cd frontend
npm install
cp .env.example .env   # set VITE_API_BASE_URL and VITE_*_REMOTE_URL if not using the defaults
npm run dev            # starts the shell and all three remotes together
```

The shell runs at `http://localhost:5173` and loads each remote's `remoteEntry.js` from the URL configured by its `VITE_*_REMOTE_URL` env var (defaults to `http://localhost:517{4,5,6}/remoteEntry.js`). All apps expect the backend (see `../backend`) to be running at the URL configured in `VITE_API_BASE_URL` (default `http://localhost:3001`). Make sure the backend's `FRONTEND_URL` env var matches the shell's origin so CORS allows requests.

## Scripts (run from `frontend/`, applied across all workspaces)

- `npm run dev` — start every app's Vite dev server
- `npm run dev:shell` / `dev:trading` / `dev:market` / `dev:admin` — start a single app
- `npm run build` — type-check and build every app for production
- `npm run lint` — run ESLint across every app

Each app can also run standalone (e.g. `npm run dev --workspace=market_remote`) — when not loaded inside the shell, it renders a `StandalonePreview` so it can be developed and previewed in isolation.

## Structure

- `shared/` — code shared across the shell and remotes (`@shared/*`): API client (with auth-refresh interceptor), query client, auth/toast contexts & hooks, UI primitives (`components/ui/`), layout shells, formatting helpers, the Tailwind theme (`index.css`)
- `shell/src/router.tsx` — route table; lazy-loads remote pages via `lib/remoteLazy.tsx`'s `remotePage()` helper (Suspense + graceful fallback if a remote can't be reached)
- `shell/src/remotes.d.ts` — ambient module declarations for the federated remote imports
- `remotes/*/vite.config.ts` — each remote's `federation()` config declares which pages it `exposes`
- `remotes/market/src/components/TradingViewChart.tsx` — embeds TradingView's free Advanced Real-Time Chart widget (drawing tools, indicators, multiple timeframes) for market and signal pages

## Status

**Stage 1 (golden path)** — register → verify email → sign in (incl. 2FA) → dashboard → place/cancel orders → manage positions → view portfolio → search market data & live prices → generate and review AI signals.

**Stage 2 (complete)** — broker connections (connect/rename/test/sync/disconnect, OAuth-style "connected" redirect page), billing & subscriptions (pricing plans, monthly/annual toggle, subscribe/switch/cancel/reactivate, invoices & usage), and account settings (profile, password change, 2FA setup, active sessions, API key management).

Order placement is wired end-to-end to broker connections: the order form requires selecting an active connection and prompts users to connect a broker first if none exists.
