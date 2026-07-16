# Read-Only Symbol Analysis Page + Watchlist Deep-Link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring a read-only symbol analysis page onto `master` at `/analyze/:symbol` and re-link watchlist rows to it, excluding all live-trading controls.

**Architecture:** Surgically materialize the analysis feature's files from the `origin/symbol-analysis-page` branch onto a fresh branch off `master` (file checkout, not commit cherry-pick, because that branch interleaves analysis and trading commits). Adapt the page to drop the `TradeTicket`, wire the route, and revert the watchlist row stub. All required backend endpoints already exist on `master`.

**Tech Stack:** React 19 + TypeScript, React Router, TanStack Query, `lightweight-charts@^5.2.0`, Vitest + Testing Library, Tailwind v4.

## Global Constraints

- **No dependency changes.** `lightweight-charts@^5.2.0` is already in `frontend/package.json` on `master`.
- **No backend changes.** All endpoints are present on `master`: `GET /market/history/:symbol`, `GET /analysis/latest/:symbol`, `GET /analysis/signals/:id`.
- **No `types/api.ts` changes.** `Candle`, `Signal`, `MarketSnapshot` are already on `master`; indicator types come from the materialized `lib/indicators/`.
- **Read-only — never bring `TradeTicket.tsx` or `SignalTradeButtons.tsx`** (live `POST /trading/orders` deferred while the engine is in paper trial).
- **Materialize verbatim** from `origin/symbol-analysis-page` for every file except `SymbolAnalysisPage.tsx` and `SymbolAnalysisPage.test.tsx`, which are adapted.
- **Lint gate:** run `cd frontend && npx eslint . --max-warnings 0` before every commit (a `no-useless-escape` slipped past CI earlier this project).
- **Branch:** work happens on `feat/symbol-analysis-standalone` (already created off `master`, holds the design spec commit).

---

### Task 1: Materialize the analysis substrate (indicators lib, hooks, chart + indicator components)

Verbatim file materialization. These files carry their own passing unit tests and reference only each other plus modules already on `master` (`Candle` type, `@/lib/api`, `@/components/ui/*`, `lightweight-charts`).

**Files:**
- Create: `frontend/src/lib/indicators/types.ts`
- Create: `frontend/src/lib/indicators/overlays.ts`
- Create: `frontend/src/lib/indicators/overlays.test.ts`
- Create: `frontend/src/lib/indicators/panes.ts`
- Create: `frontend/src/lib/indicators/panes.test.ts`
- Create: `frontend/src/lib/indicators/__fixtures__/parity.json`
- Create: `frontend/src/hooks/useCandles.ts`
- Create: `frontend/src/hooks/useCandles.test.tsx`
- Create: `frontend/src/hooks/useChartLayout.ts`
- Create: `frontend/src/hooks/useChartLayout.test.tsx`
- Create: `frontend/src/components/analysis/AnalysisChart.tsx`
- Create: `frontend/src/components/analysis/AnalysisChart.test.tsx`
- Create: `frontend/src/components/analysis/IndicatorManager.tsx`
- Create: `frontend/src/components/analysis/IndicatorManager.test.tsx`

**Interfaces:**
- Produces (consumed by Task 2): `AnalysisChart` (React component), `IndicatorManager` (React component), `useCandles(symbol, timeframe) => { candles, currentPrice, isLoading, hasMore, loadOlder }` and `mergeLivePrice(candles, price)` from `@/hooks/useCandles`, `useChartLayout() => { layout, setLayout }` from `@/hooks/useChartLayout`, and `IndicatorConfig` / `DEFAULT_LAYOUT` from `@/lib/indicators/types`.

- [ ] **Step 1: Ensure the source branch is fetched**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git fetch origin symbol-analysis-page
git rev-parse origin/symbol-analysis-page   # should print a SHA
```

- [ ] **Step 2: Materialize the file set from the branch**

```bash
git checkout origin/symbol-analysis-page -- \
  frontend/src/lib/indicators/types.ts \
  frontend/src/lib/indicators/overlays.ts \
  frontend/src/lib/indicators/overlays.test.ts \
  frontend/src/lib/indicators/panes.ts \
  frontend/src/lib/indicators/panes.test.ts \
  frontend/src/lib/indicators/__fixtures__/parity.json \
  frontend/src/hooks/useCandles.ts \
  frontend/src/hooks/useCandles.test.tsx \
  frontend/src/hooks/useChartLayout.ts \
  frontend/src/hooks/useChartLayout.test.tsx \
  frontend/src/components/analysis/AnalysisChart.tsx \
  frontend/src/components/analysis/AnalysisChart.test.tsx \
  frontend/src/components/analysis/IndicatorManager.tsx \
  frontend/src/components/analysis/IndicatorManager.test.tsx
```

- [ ] **Step 3: Confirm no forbidden trading files were pulled in**

Run:
```bash
test ! -e frontend/src/components/analysis/TradeTicket.tsx && \
test ! -e frontend/src/components/analysis/SignalTradeButtons.tsx && echo OK-no-trading-files
```
Expected: `OK-no-trading-files`

- [ ] **Step 4: Typecheck the substrate**

Run: `cd frontend && npx tsc -b`
Expected: exits 0 with no output. (These files import only `Candle` from `@/types/api` and other master modules; nothing references the not-yet-created page.)

- [ ] **Step 5: Run the materialized unit tests**

Run:
```bash
cd frontend && npx vitest run \
  src/lib/indicators/overlays.test.ts \
  src/lib/indicators/panes.test.ts \
  src/hooks/useCandles.test.tsx \
  src/hooks/useChartLayout.test.tsx \
  src/components/analysis/AnalysisChart.test.tsx \
  src/components/analysis/IndicatorManager.test.tsx
```
Expected: all test files pass.

- [ ] **Step 6: Lint**

Run: `cd frontend && npx eslint . --max-warnings 0`
Expected: exits 0, no output.

- [ ] **Step 7: Commit**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git add frontend/src/lib/indicators frontend/src/hooks/useCandles.ts frontend/src/hooks/useCandles.test.tsx frontend/src/hooks/useChartLayout.ts frontend/src/hooks/useChartLayout.test.tsx frontend/src/components/analysis
git commit -m "feat: analysis charting substrate (indicators, candles, chart components)"
```

---

### Task 2: Read-only symbol analysis page + `/analyze/:symbol` route

Materialize the page and its test, adapt both to remove the `TradeTicket`, and register the route.

**Files:**
- Create: `frontend/src/pages/analysis/SymbolAnalysisPage.tsx` (materialized, then edited)
- Create: `frontend/src/pages/analysis/SymbolAnalysisPage.test.tsx` (materialized, then edited)
- Modify: `frontend/src/router.tsx`

**Interfaces:**
- Consumes (from Task 1): `AnalysisChart`, `IndicatorManager`, `useCandles`, `mergeLivePrice`, `useChartLayout`.
- Produces (consumed by Task 3): route `/analyze/:symbol` rendering `SymbolAnalysisPage`.

- [ ] **Step 1: Materialize the page and its test**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git checkout origin/symbol-analysis-page -- \
  frontend/src/pages/analysis/SymbolAnalysisPage.tsx \
  frontend/src/pages/analysis/SymbolAnalysisPage.test.tsx
```

- [ ] **Step 2: Adapt the test first — drop the trade-ticket assertion**

In `frontend/src/pages/analysis/SymbolAnalysisPage.test.tsx`:

Rename the first test and remove its ticket assertion. Change:
```tsx
  test('renders chart, signal summary and ticket from the latest signal', async () => {
    mockApi()
    renderAt('/analyze/AAPL')
    expect(await screen.findByTestId('analysis-chart')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('analysis-chart')).toHaveAttribute('data-signal', 'sig-1'))
    expect(screen.getByText(/momentum breakout/i)).toBeInTheDocument()
    expect(screen.getByText(/82/)).toBeInTheDocument()
    expect(screen.getByText(/Trade AAPL/i)).toBeInTheDocument()
  })
```
to:
```tsx
  test('renders chart and signal summary from the latest signal', async () => {
    mockApi()
    renderAt('/analyze/AAPL')
    expect(await screen.findByTestId('analysis-chart')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('analysis-chart')).toHaveAttribute('data-signal', 'sig-1'))
    expect(screen.getByText(/momentum breakout/i)).toBeInTheDocument()
    expect(screen.getByText(/82/)).toBeInTheDocument()
  })
```

(Leave the `mockApi` handlers for `/brokers/connections`, `/auto-trading/settings`, `/users/me` as-is — harmless once the page no longer calls them.)

- [ ] **Step 3: Run the page test — expect it to FAIL to compile**

Run: `cd frontend && npx vitest run src/pages/analysis/SymbolAnalysisPage.test.tsx`
Expected: FAILS — the page still imports `TradeTicket` (which imports its own tree). This confirms we are about to edit the page. (If it happens to pass, proceed anyway.)

- [ ] **Step 4: Adapt the page — remove the TradeTicket**

In `frontend/src/pages/analysis/SymbolAnalysisPage.tsx`, make these four edits:

Remove the import line:
```tsx
import { TradeTicket } from '@/components/analysis/TradeTicket'
```

Remove the `armed` derivation (it is only consumed by the ticket):
```tsx
  const armed = searchParams.get('arm') === '1'
```

Remove the ticket element from the sidebar (last child before the two closing `</div>`s):
```tsx
          <TradeTicket symbol={symbol} signal={signal} currentPrice={currentPrice} armed={armed} />
```

Fix the empty-state copy — change:
```tsx
                <p className="text-muted">No AI signal for {symbol} yet. Generate one from the Signals page, or trade manually below.</p>
```
to:
```tsx
                <p className="text-muted">No AI signal for {symbol} yet. Generate one from the Signals page.</p>
```

- [ ] **Step 5: Register the route**

In `frontend/src/router.tsx`:

Add the import after the `WatchlistPage` import:
```tsx
import { WatchlistPage } from '@/pages/watchlist/WatchlistPage'
import { SymbolAnalysisPage } from '@/pages/analysis/SymbolAnalysisPage'
```

Add the route after the `/watchlist` route (inside the `<AppLayout />` children array):
```tsx
          { path: '/watchlist', element: <WatchlistPage /> },
          { path: '/analyze/:symbol', element: <SymbolAnalysisPage /> },
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: exits 0. (No unused `armed`, no missing `TradeTicket`.)

- [ ] **Step 7: Run the page test — expect PASS**

Run: `cd frontend && npx vitest run src/pages/analysis/SymbolAnalysisPage.test.tsx`
Expected: 4 tests pass.

- [ ] **Step 8: Lint**

Run: `cd frontend && npx eslint . --max-warnings 0`
Expected: exits 0, no output.

- [ ] **Step 9: Commit**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git add frontend/src/pages/analysis frontend/src/router.tsx
git commit -m "feat: read-only symbol analysis page at /analyze/:symbol"
```

---

### Task 3: Re-link watchlist rows to the analysis page

Revert the row stub added during the standalone watchlist extraction so each row links to `/analyze/:symbol` again.

**Files:**
- Modify: `frontend/src/pages/watchlist/WatchlistPage.tsx`
- Test: `frontend/src/pages/watchlist/WatchlistPage.test.tsx`

**Interfaces:**
- Consumes (from Task 2): route `/analyze/:symbol`.

- [ ] **Step 1: Write the failing test — a row links to the analysis page**

In `frontend/src/pages/watchlist/WatchlistPage.test.tsx`, add this test inside the `describe('WatchlistPage', ...)` block:
```tsx
  test('each row links to the symbol analysis page', async () => {
    mockGet(['AAPL', 'MSFT'])
    renderPage()
    const link = await screen.findByRole('link', { name: /AAPL/ })
    expect(link).toHaveAttribute('href', '/analyze/AAPL')
  })
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd frontend && npx vitest run src/pages/watchlist/WatchlistPage.test.tsx -t "links to the symbol analysis page"`
Expected: FAIL — the row currently renders a `<div>`, so no `link` role with name `AAPL` exists.

- [ ] **Step 3: Restore the `Link` import**

In `frontend/src/pages/watchlist/WatchlistPage.tsx`, add the import after the React import:
```tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
```

- [ ] **Step 4: Replace the static row label with a Link**

Replace this block:
```tsx
                {/* Row is non-interactive here: the /analyze symbol page ships in a
                    separate change, so we render the label statically rather than
                    linking to a route that doesn't exist yet. */}
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{sym}</div>
                  <div className="truncate text-xs text-muted">{SYMBOL_NAMES[sym] ?? ''}</div>
                </div>
```
with:
```tsx
                <Link to={`/analyze/${sym}`} className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{sym}</div>
                  <div className="truncate text-xs text-muted">{SYMBOL_NAMES[sym] ?? ''}</div>
                </Link>
```

- [ ] **Step 5: Run the watchlist test suite — expect PASS**

Run: `cd frontend && npx vitest run src/pages/watchlist/WatchlistPage.test.tsx`
Expected: all tests pass (including the new link test).

- [ ] **Step 6: Typecheck + lint**

Run: `cd frontend && npx tsc -b && npx eslint . --max-warnings 0`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git add frontend/src/pages/watchlist/WatchlistPage.tsx frontend/src/pages/watchlist/WatchlistPage.test.tsx
git commit -m "feat: link watchlist rows to symbol analysis"
```

---

### Task 4: Integration verification and PR

Full-suite gate, production build, live click-through, then open the PR.

**Files:** none (verification + delivery).

- [ ] **Step 1: Full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all suites pass (indicators, hooks, analysis components, analysis page, watchlist, plus the pre-existing suites).

- [ ] **Step 2: Lint the whole frontend**

Run: `cd frontend && npx eslint . --max-warnings 0`
Expected: exits 0.

- [ ] **Step 3: Production build**

Run: `cd frontend && npm run build`
Expected: `✓ built` with no errors (chunk-size warning is pre-existing and acceptable).

- [ ] **Step 4: Live click-through**

Start backend (`cd backend && npm start`) and frontend (`cd frontend && npm run dev`). Log in, open `/watchlist`, click a row (e.g. AAPL). Verify:
- URL becomes `/analyze/AAPL`
- Chart renders; timeframe tabs and the indicator manager work
- AI signal card shows a signal or the "No AI signal…" empty state
- No console errors; **no trade-ticket / order controls anywhere on the page**

- [ ] **Step 5: Push and open the PR**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git push -u origin feat/symbol-analysis-standalone
gh pr create --base master --head feat/symbol-analysis-standalone \
  --title "feat: read-only symbol analysis page + watchlist deep-link" \
  --body "Extracts PR #3's symbol analysis page onto master (read-only) at /analyze/:symbol and re-links watchlist rows. Excludes TradeTicket / signal-card trading (deferred while the engine is in paper trial). All backend endpoints already on master; no dependency changes. See docs/superpowers/specs/2026-07-15-symbol-analysis-standalone-design.md."
```

- [ ] **Step 6: Watch CI to green**

Run: `gh run watch "$(gh run list --branch feat/symbol-analysis-standalone --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status --interval 15`
Expected: Test & Lint, Trivy, SonarCloud, SonarQube all pass. Then hand off to the user for the merge decision.

---

## Self-Review

**Spec coverage:**
- Route `/analyze/:symbol` + page → Task 2. ✅
- Chart + indicators + read-only signal card → Task 1 (substrate) + Task 2 (page). ✅
- Watchlist re-link → Task 3. ✅
- Exclude TradeTicket / SignalTradeButtons → Global Constraints + Task 1 Step 3 (assert absent) + Task 2 Step 4 (removal). ✅
- No backend / no dependency / no `types/api.ts` change → Global Constraints (verified in spec). ✅
- Verification (tsc, lint, tests, build, live) + 2–3 logical commits + PR → Task 4. ✅ (Plan yields three feature commits — substrate, page+route, re-link — a finer split than the spec's "two logical commits"; noted and acceptable.)

**Placeholder scan:** No TBD/TODO; every code step shows exact content; every command has expected output. ✅

**Type consistency:** `useCandles`/`mergeLivePrice`/`useChartLayout`/`IndicatorConfig`/`DEFAULT_LAYOUT` names in the Task 1 interface match the imports in the materialized `SymbolAnalysisPage.tsx` used by Task 2. Route path `/analyze/:symbol` matches the `Link to={`/analyze/${sym}`}` in Task 3. ✅
