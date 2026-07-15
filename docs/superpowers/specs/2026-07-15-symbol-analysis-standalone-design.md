# Symbol Analysis Page (read-only) on `master` + Watchlist Deep-Link — Design Spec

**Date:** 2026-07-15
**Status:** Approved (design), pending spec review

## Summary

Bring a **read-only symbol analysis page** onto `master` at route
`/analyze/:symbol`, and **re-link watchlist rows** to it. On `master` today,
watchlist rows render statically (the `<Link to="/analyze/:symbol">` was stubbed
to a `<div>` during the standalone watchlist extraction) because the analysis
page did not exist on `master`.

The full analysis page lives on the `symbol-analysis-page` branch (PR #3), which
is stacked behind `engine-v2` (PR #2, deliberately in a multi-week paper trial)
and therefore blocked from reaching `master` via the normal stack for weeks. To
unblock the watchlist link now, we **surgically extract** the analysis page onto
a fresh branch off `master` — mirroring the earlier watchlist extraction.

The page is brought in **read-only**: chart + indicators + AI signal card. The
**live TradeTicket** (one-click `POST /trading/orders` against connected brokers)
and signal-card trading are **explicitly excluded**, keeping live manual-trade
execution off `master` while the autonomous engine is still in its paper trial.

## Goals

- New route `/analyze/:symbol` on `master` rendering `SymbolAnalysisPage`.
- Interactive price chart via `AnalysisChart` (uses `lightweight-charts`, already
  a `master` dependency) with an `IndicatorManager` for overlays.
- Read-only **AI signal card** in the right sidebar (confidence, analysis text,
  generated date) — no trading controls.
- Re-link watchlist rows: revert the stub so each row again links to
  `/analyze/:symbol`.
- Fully functional end-to-end on `master` — all required backend endpoints
  (`/market/history/:symbol`, `/market/indicators/:symbol`,
  `/market/snapshot/:symbol`, `/signals`) already exist on `master`.

## Non-Goals (YAGNI / deferred)

- **TradeTicket** — live order placement from the analysis page. Deferred.
- **SignalTradeButtons** and any signal-card one-click trading. Out of scope.
- The "instant orders" preference toggle (lived inside TradeTicket) — omitted
  with it.
- Adding analysis links anywhere other than watchlist rows (e.g., signals,
  dashboard). Only the watchlist re-link is in scope.
- Merging or re-basing the PR stack (#1–#6). This extraction is additive to
  `master`, consistent with the earlier watchlist extraction; it knowingly adds
  more `master`↔stack content overlap.
- A nav entry for analysis (it is a deep, symbol-scoped route, not a top-level
  destination).

## Feasibility (verified)

- **Backend:** all endpoints the page calls are already on `master` —
  `market.js` has `/history/:symbol`, `/indicators/:symbol`, `/snapshot/:symbol`,
  `/search`, `/prices`; `/signals` exists; `trading.js` has `POST /orders` (only
  needed by the excluded TradeTicket).
- **Charting dependency:** `lightweight-charts@^5.2.0` is already in
  `frontend/package.json` on `master` — no dependency change.
- **Shared libs:** `formatDate` and `signalBadgeVariant` (`lib/format`) are on
  `master`. Types `Signal`, `Candle`, `MarketSnapshot`, `SearchResult` are
  already on `master`; only analysis-specific type gaps (if any) are added.

## Page Layout Without the TradeTicket

`SymbolAnalysisPage` layout is `flex-col lg:flex-row`:

- **Left (`flex-1`):** `AnalysisChart` + `IndicatorManager` + chart controls
  (log scale, fullscreen).
- **Right sidebar (`lg:w-96`):** today holds the **AI signal card on top** and
  the **TradeTicket below**.

Removing the TradeTicket leaves the **AI signal card as the sole sidebar
content** — a clean, gap-free result. The one line of copy that reads
*"…or trade manually below"* is updated to drop that clause.

## Extraction Mechanics

**Method: file materialization, not cherry-pick.** The `symbol-analysis-page`
branch interleaves analysis commits with trading commits (SignalTradeButtons,
instant-mode signal trading). Replaying commits would be messy and drag in
unwanted trading work. Instead: branch off `master`, then materialize the exact
analysis file set with `git checkout origin/symbol-analysis-page -- <files>` and
adapt. History granularity from PR #3 is intentionally not preserved; the
extraction is captured as a small number of clean logical commits.

**Files brought in (with their tests):**

- `frontend/src/pages/analysis/SymbolAnalysisPage.tsx`
- `frontend/src/components/analysis/AnalysisChart.tsx`
- `frontend/src/components/analysis/IndicatorManager.tsx`
- `frontend/src/hooks/useCandles.ts`
- `frontend/src/hooks/useChartLayout.ts`

**Deliberately not brought:** `components/analysis/TradeTicket.tsx`,
`components/analysis/SignalTradeButtons.tsx` (and their tests).

**Adaptations:**

1. `SymbolAnalysisPage.tsx` — remove the `TradeTicket` import and `<TradeTicket>`
   usage; drop the `armed` state/prop if it only fed the ticket; update the
   "…or trade manually below" copy; strip TradeTicket assertions from
   `SymbolAnalysisPage.test.tsx`.
2. `router.tsx` — add `import { SymbolAnalysisPage }` and
   `{ path: '/analyze/:symbol', element: <SymbolAnalysisPage /> }`.
3. `types/api.ts` — add only analysis-specific types not already on `master`
   (bring the gaps, not the stack's unrelated engine types).
4. `WatchlistPage.tsx` — revert the stub: restore
   `<Link to={\`/analyze/${sym}\`}>`, re-add the `Link` import, remove the stub
   comment.

**Watch-outs (lessons from this session):**

- Run `eslint --max-warnings 0` (both `backend/` and `frontend/`) locally before
  pushing — a `no-useless-escape` slipped past once and reddened CI.
- Confirm no dangling imports/references to the omitted trading components remain
  in any brought-in file.

## Verification

- **Local:** `tsc -b`, backend + frontend lint, `vitest run` (analysis component
  + page suites, adapted; watchlist suite unchanged), `vite build`.
- **Live:** browser click-through — watchlist row → `/analyze/:symbol` → chart
  renders, indicators toggle, signal card shows (or empty state), no console
  errors, no dead trade controls.

## Delivery

- Fresh branch off `master`; open a PR to `master`; watch CI
  (Test & Lint, Trivy, SonarCloud/SonarQube) to green; merge on user go-ahead.
- **Two logical commits:**
  1. `feat: read-only symbol analysis page at /analyze/:symbol`
  2. `feat: link watchlist rows to symbol analysis`

## Future / Follow-ups

- When the autonomous engine clears its paper trial and the stack (PRs #2→#3…)
  merges up, the trading components (TradeTicket, SignalTradeButtons) arrive with
  it. Re-enabling live trading from the analysis page then is a small, deliberate
  change (restore the TradeTicket in the sidebar).
- This extraction adds `master`↔stack overlap for the analysis page, same as the
  watchlist extraction did; when PR #3 eventually reaches `master` it will show
  its analysis content as already-present.
