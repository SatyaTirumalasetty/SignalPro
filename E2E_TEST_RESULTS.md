# Stage 1 Frontend — End-to-End Test Results

**Date:** 2026-06-07
**Method:** Full stack run live (Docker Postgres + Redis, backend on `:3001`, Vite frontend on `:5173`), driven by a headless Playwright (Chromium) scenario runner against the real, running application — no mocks.

## Environment setup

1. Started `docker compose up -d postgres redis` (remapped Postgres host port `5433:5432` in `docker-compose.yml` to avoid a conflict with a native Windows PostgreSQL service already bound to `5432`; internal container networking on `postgres:5432` is unaffected).
2. Created `backend/.env` from `.env.example`: generated fresh `JWT_SECRET`/`JWT_REFRESH_SECRET`/`ENCRYPTION_KEY`/`ENCRYPTION_IV`, pointed DB config at the local Docker Postgres (`signalpro`/`signalpro_dev_password`@`localhost:5433`), set `NODE_ENV=development`, set frontend/API URLs to `localhost:5173`/`localhost:3001`, and blanked SMTP credentials so the backend logs verification emails instead of sending them (dev-mode fallback already built into `emailService.js`).
3. Loaded `database/init.sql` plus migrations `001`/`002` into the running container, then wrote and applied a new migration `database/migrations/003_users_role_column.sql` (see Bug 2 below).
4. Started backend (`npm run dev` → health check OK on `:3001`) and frontend (`npm run dev` → `:5173`).
5. Installed `playwright` as a temporary devDependency in `frontend/`, wrote `e2e-test.cjs` (a 13-scenario runner that registers a fresh user, fetches its email-verification token directly from Postgres via `docker exec ... psql` to bypass SMTP, then walks the full golden path), and ran it iteratively — fixing both real app bugs and test-script issues as they surfaced (9 iterations total).

## Scenario results (final run)

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | Register new user | **PASS** | Confirmation screen shown (`01-register-filled.png`, `02-register-result.png`) |
| 2 | Fetch verification token from DB | **PASS** | Token retrieved via direct Postgres query |
| 3 | Verify email via token link | **PASS** | `/verify-email?token=...` shows success (`03-verify-email-result.png`) |
| 4 | Login with verified credentials | **PASS** | Redirects to dashboard (`04-login-filled.png`, `05-login-result.png`) |
| 5 | Dashboard loads with widgets | **PASS** | Open/closed positions, P&L, recent orders, latest signals all render (`06-dashboard.png`) |
| 6 | Place a new order | **INFO** | Dialog opens and submits, but order is rejected — requires a `broker_connection_id` (Stage 2 feature, see Limitations) |
| 7 | Orders list shows placed order | **INFO** | List renders correctly but is empty, consistent with #6 being rejected |
| 8 | Positions page loads (open/closed tabs) | **PASS** | `12-positions.png` |
| 9 | Portfolio summary page loads | **PASS** | `13-portfolio.png` |
| 10 | Market search & snapshot/chart | **PASS** | Search returns AAPL, candlestick chart renders, indicators panel shows formatted values (`14-market-search.png`, `15-market-snapshot.png`) |
| 11 | Generate AI signal | **INFO** | Request reaches the backend and Anthropic API correctly, but fails auth — placeholder `ANTHROPIC_API_KEY` (see Limitations) |
| 12 | Signal performance page loads | **PASS** | `18-signal-performance.png` |
| 13 | Logout returns to login page | **PASS** | `19-after-logout.png` |

**9 PASS, 3 INFO (expected/documented limitations), 0 FAIL.** No console/page errors remained in the final run.

## Bugs found and fixed (6 real app bugs + 1 cosmetic)

These were **not** caught by the existing 442-test unit suite because it mocks the `db`, `marketData`, and `aiAnalysis` modules — it never touches the real schema or wiring between routes and services, and there are no UI integration tests. All six were only discoverable by exercising the live stack end-to-end.

### 1. `VerifyEmailPage` — React StrictMode double-fire race
**File:** `frontend/src/pages/auth/VerifyEmailPage.tsx`
React 18 StrictMode double-invokes effects in dev. The verify-email POST is non-idempotent (the token is consumed on first use), so the second invocation received "token already used" and showed an error despite a successful verification. Fixed with a `useRef` guard that tracks the token already requested:
```tsx
const requestedRef = useRef<string | null>(null)
useEffect(() => {
  if (!token || requestedRef.current === token) return
  requestedRef.current = token
  api.post('/auth/verify-email', { token })...
}, [token])
```

### 2. Missing `users.role` column — every login failed
**File (new):** `database/migrations/003_users_role_column.sql`
`backend/src/routes/auth.js` and `backend/src/middleware/auth.js` select `role` from `users` and embed it in JWTs (defaulting to `'user'`), but the column didn't exist in the schema actually loaded — every login query failed with Postgres error `42703: column "role" does not exist`, blocking all sign-ins. Added and applied:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
```

### 3. `formatPercent` crashed on Postgres `NUMERIC` strings
**File:** `frontend/src/lib/format.ts`
`pg`/`pg-promise` serializes `NUMERIC`/`DECIMAL` columns as JSON strings, but `formatPercent` assumed a `number` and crashed (`toFixed is not a function`) when rendering `change_percent` on the Market page. Fixed by coercing strings to numbers before formatting:
```ts
const num = typeof value === 'string' ? Number(value) : value
if (Number.isNaN(num)) return '—'
```

### 4. `getApiErrorMessage` didn't handle express-validator's error shape
**File:** `frontend/src/lib/api.ts`
Validation failures return `{ errors: [{ msg, path, ... }] }`, not `{ error: "..." }`. The helper only checked the latter, so validation errors surfaced as raw Axios messages ("Request failed with status code 400") instead of the actual field-level message. Added handling for the `errors` array shape, joining `msg`/`message`/a derived "Invalid `<field>`" fallback.

### 5. Wrong variable passed into AI signal generation — guaranteed crash
**File:** `backend/src/routes/analysis.js`
`POST /api/analysis/generate` fetched both `getCurrentPrice(symbol)` and `getHistoricalData(...)`, then passed `priceData` (the current-price object) to `generateSignal(...)` where the historical-candle data (`histData`) was expected — a guaranteed runtime crash on every real invocation. The redundant `getCurrentPrice` call was also removed (unused otherwise). Before/after:
```js
// before
const [priceData, histData] = await Promise.all([getCurrentPrice(symbol), getHistoricalData(symbol, timeframe, 250)]);
...
generateSignal(req.user.id, symbol, timeframe, priceData, indicators)

// after
const histData = await getHistoricalData(symbol, timeframe, 250);
...
generateSignal(req.user.id, symbol, timeframe, histData, indicators)
```
Verified the fix doesn't break unit coverage: `npx jest src/__tests__/phase3/analysis.test.js src/__tests__/phase3/aiAnalysis.test.js` → 27/27 passing (the mocks were shape-compatible regardless of which variable was passed, which is exactly why this bug went undetected by the unit suite).

### 6. `PriceChart` crashed on lightweight-charts v5 date format
**File:** `frontend/src/components/PriceChart.tsx` (+ `frontend/src/types/api.ts`)
lightweight-charts v5 requires `time` as a `UTCTimestamp` (UNIX seconds, a `number`) or `BusinessDay`, but the backend returns ISO datetime strings for candles, and the component passed them through directly — crashing the chart. Fixed by converting to UNIX seconds, and corrected the `Candle.time` TypeScript type from `number` to `string` to match the actual backend response:
```tsx
time: (new Date(c.time).getTime() / 1000) as UTCTimestamp,
```

### 7. (Cosmetic) Raw `JSON.stringify` indicator display
**File:** `frontend/src/pages/market/MarketPage.tsx`
Compound indicators (MACD, Bollinger Bands, Stochastic) rendered as raw JSON blobs. Replaced with formatted, readable strings — confirmed in `15-market-snapshot.png`:
- `MACD: macd: -0.46 · signal: 0.07 · histogram: -0.53`
- `BOLLINGER BANDS: upper: 313.82 · middle: 310.63 · lower: 307.44 · bandwidth: 2.05`
- `STOCHASTIC: k: 2.37 · d: 2.37`

## Documented limitations (not bugs)

1. **Placing orders requires a broker connection.** `POST /api/trading/orders` requires `broker_connection_id`, and the broker-connections UI is explicitly listed as "not yet implemented" (Stage 2) in `frontend/README.md`. The order dialog opens and submits correctly; the backend correctly rejects it for the missing dependency. This will resolve once Stage 2's broker-connection flow ships.
2. **AI signal generation requires a real Anthropic API key.** `backend/.env` still has the placeholder `ANTHROPIC_API_KEY=sk-ant-your-key-here`. After fixing Bug 5, the request now correctly reaches Anthropic's API and fails with a clean 401 (auth error from Anthropic) — confirming the entire pipeline (route → market data → indicators → AI service → Anthropic) now works end-to-end up to the point of needing real credentials.

## Verification performed alongside E2E

- `npm run build` (frontend): clean TypeScript compile, 596.36 kB main chunk (gzip 188.93 kB) — run twice, both clean
- `npx jest src/__tests__/phase3/analysis.test.js src/__tests__/phase3/aiAnalysis.test.js` (backend): 27/27 passing after the `analysis.js` fix
- 9 full E2E iterations (`e2e-output.log` → `e2e-output9.log`), each fixing either a real bug or a test-script issue, converging to 0 console/page errors and the final all-PASS/INFO result above

## Files changed for this testing effort (kept)

- `docker-compose.yml` — Postgres host port remapped `5433:5432` (local dev port-conflict workaround)
- `database/migrations/003_users_role_column.sql` — new migration adding the missing `users.role` column (real schema fix, needed in all environments)
- `backend/src/routes/analysis.js` — real bug fix (wrong variable passed to `generateSignal`)
- `frontend/src/pages/auth/VerifyEmailPage.tsx`, `frontend/src/lib/format.ts`, `frontend/src/lib/api.ts`, `frontend/src/components/PriceChart.tsx`, `frontend/src/types/api.ts`, `frontend/src/pages/market/MarketPage.tsx` — real bug fixes / cosmetic improvements

`backend/.env` is gitignored (local secrets/config, not committed). Temporary E2E test artifacts (`playwright` devDependency, `e2e-test.cjs`, `e2e-shots/`, `e2e-output*.log`) are removed as part of cleanup below.
