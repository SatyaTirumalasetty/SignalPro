# Engine Observability Dashboard — Design

**Date:** 2026-07-14
**Branch (proposed):** `engine-observability-dashboard`
**Status:** Approved design — ready for implementation planning
**Sub-project:** 1 of 4 in the engine operator experience (see "Sequencing" below).

## Problem & purpose

SignalPro's autonomous engine (v2) makes one fused multi-timeframe Claude decision
per symbol per cycle, wrapped in deterministic code guardrails, and records every
cycle to `auto_trading_runs` plus a daily `benchmark_snapshots` row. Today the only
way to see what it did is the config page (`/auto-trading`, `AutoTradingPage.tsx`),
which bolts a flat 50-row activity table and the benchmark chart onto the bottom of
a long settings form. It throws away most of the rich `action_detail` JSONB and
offers no aggregation, filtering, or per-symbol view.

During the current 2–4 week paper trial the central question is **"is the engine any
good — do I trust it with real money?"**, with a secondary **"is it running correctly
right now?"**. Neither is answerable today.

This dashboard is the **trust layer** for autonomous trading: transparency *is* the
product. It is the first of the four engine operator features and sets up the "Engine"
area the others grow into.

**Primary job:** both evaluation and live-ops health, **evaluation-led**.

## Scope

**In scope (v1):** a new, read-only dashboard page with seven panels (five core plus
two differentiating), backed by new SQL-aggregation endpoints. No mutations.

**Out of scope (later sub-projects, in sequence):**
- Control actions (start/stop, kill-switch, mode switch, authority toggles) — sub-project 2.
- Strategy / watchlist / risk config builder — sub-project 3.
- Alerts & notifications — sub-project 4.
- AI-cost tracking — token/cost is **not currently persisted**; a cost panel is deferred
  until capture is added.
- Adding a hard engine-source foreign key to `positions` (see "Attribution caveat").

## Architecture & placement

- **Route:** `GET /auto-trading/dashboard` (new page), mirroring the existing
  `/signals/performance` sub-page convention. The config page stays at `/auto-trading`.
  The two cross-link (config → "View dashboard", dashboard → "Settings").
- **Nav:** add a nav entry (label "Engine" or "Auto-Trading Dashboard") in `AppLayout`.
- **Read-only:** every endpoint is a `SELECT`; safe to ship mid-trial. No new writes,
  no schema changes.
- **Reuse:** `<BenchmarkChart>`, and the shadcn-style primitives already in
  `src/components/ui/` (`Card`, `Table`, `Badge`, `Select`, `Collapsible`). Data via
  `@tanstack/react-query`, matching `AutoTradingPage`.
- **New frontend page:** `frontend/src/pages/trading/EngineDashboardPage.tsx`, composed
  of one small component per panel so each is independently testable and the page file
  stays focused (the existing `AutoTradingPage` is already ~500 lines doing double duty —
  we do not add to it).

## Panels (top → bottom, layout A — single-column vertical stack)

1. **Health strip** — compact row: engine status (enabled/disabled), last-cycle time +
   ok/error, errors-in-24h vs circuit-breaker threshold (`CIRCUIT_BREAKER_ERROR_THRESHOLD`
   = 5), trades today. Answers "is it running correctly right now?".
2. **Performance vs buy-and-hold** — `<BenchmarkChart>` (engine equity vs equal-weight
   buy-and-hold frozen at first snapshot) plus KPI tiles: return, vs-B&H delta, win rate,
   trade count. Keeps the existing "appears after 2nd snapshot" empty-state copy.
3. **Decision breakdown** — action-mix bars over the trial window
   (`order_placed` / `skipped_low_confidence` / `skipped_existing_position` / holds /
   `error` / etc.) plus average decision confidence.
4. **Per-symbol performance** — table: **Symbol · Trades · Win % · Realized P&L ·
   Unrealized P&L · Avg confidence · Last action**.
5. **Activity feed** — the existing runs log, now filterable by symbol / action / date
   range, each row expandable to the full `action_detail` (per-timeframe alignment, the
   guardrail that fired, execution detail).
6. **⭐ Confidence calibration** *(bottom; graceful-degradation)* — reliability view:
   predicted confidence bucketed vs actual win rate of closed trades in each bucket.
   Shows an explicit "needs at least N closed trades to be meaningful" empty state until
   there is enough data.
7. **⭐ Guardrail-trip analytics** *(bottom; graceful-degradation)* — count/rate of cycles
   where the AI proposed an action that code blocked or modified (fail-closed entry,
   stop-tighten-only clamp, capability gate, low-confidence skip), parsed from
   `action_detail`. Shows the safety layer working. Empty state until enough cycles exist.

Panels 6–7 are placed last and stay quiet early in the trial so v1 stays lean in practice
while still shipping the differentiating trust features.

## Backend — new SQL-aggregation endpoints

All added to `backend/src/routes/autoTrading.js`, `authenticate`-gated, scoped to
`req.user.id`, returning read-only aggregates:

- **`GET /auto-trading/metrics?window=`** — single call powering the health strip,
  performance KPIs, and decision breakdown. Aggregates over `auto_trading_runs`,
  `benchmark_snapshots`, and `positions`. `window` defaults to trial-to-date.
- **`GET /auto-trading/symbol-performance`** — the per-symbol rows (realized/unrealized
  P&L, win %, trade count, avg confidence, last action).
- **`GET /auto-trading/calibration`** — confidence buckets → actual win rate over closed
  trades; returns bucket counts so the frontend can render the "insufficient data" state.
- **`GET /auto-trading/guardrail-trips?window=`** — counts by guardrail type, derived
  from `action` values and `action_detail`.
- **Extend `GET /auto-trading/activity`** — add optional `symbol`, `action`, `from`, `to`
  filters to the existing paginated endpoint (backward compatible).
- **Reuse as-is:** `GET /auto-trading/benchmark`, `GET /auto-trading/status`.

## Data flow & attribution caveat

Engine-sourced positions are identified by **symbol-correlation**: a position counts
toward the engine when that symbol has `order_placed` engine runs — the same logic the
existing `/status` `todays_pnl` query already uses. This is **approximate, not a hard
link**, because `positions` has no `source` / `opening_order_id` column (only `orders`
carries `source='engine'`). The dashboard surfaces a small "attributed by symbol" note
so the number is not over-trusted. Adding a hard engine-source column to `positions` is
listed as a future improvement and is out of scope here (keeps v1 read-only and
schema-stable).

- **Realized P&L / Win %:** closed positions (`status='closed'`) for attributed symbols;
  win % = share with `pnl > 0`.
- **Unrealized P&L:** open positions (`status='open'`), `SUM(pnl)` (maintained by broker
  sync).
- **Decision breakdown / calibration / guardrail-trips:** aggregations over
  `auto_trading_runs` (`action`, `confidence`, `decision`, `action_detail`).

## Error handling & empty states

- Each panel owns its loading / empty / populated states; a sparse trial (0–1 benchmark
  snapshots, few closed trades) renders informative empty copy, never a broken panel.
- Aggregation endpoints **fail closed** to empty/zero aggregates and must never 500 the
  page.
- Polling via react-query `refetchInterval`: 60s on health strip + activity (matches the
  `7,22,37,52 * * * *` cron cadence); performance / per-symbol / calibration / guardrail
  panels on a longer interval or manual refresh (they change at most daily/per-cycle).

## Testing

- **Backend:** unit tests per aggregation query (fixture `auto_trading_runs` + `positions`
  → expected rollups), covering the symbol-correlation attribution logic, the calibration
  bucketing, guardrail-trip parsing from `action_detail`, and empty-data cases — following
  the existing `backend/src/__tests__/phase*` patterns.
- **Frontend:** one component test per panel (loading / empty / populated) mirroring
  `AutoTradingPage.test.tsx`, plus the activity filter + row-expand interaction and the
  calibration/guardrail "insufficient data" states.

## Sequencing (engine operator experience)

1. **Observability dashboard** — this spec (read-only, serves the paper trial).
2. **Control panel** — start/stop, kill-switch, mode, authority toggles.
3. **Strategy / config builder** — watchlist, per-symbol risk, guardrail thresholds.
4. **Alerts & notifications** — push the events surfaced here (trade, guardrail trip,
   drawdown, daily digest).

They share one "Engine" area and grow into it incrementally.

## Product rationale (why this matters competitively)

SignalPro's moat is **reasoning-native autonomy with enforced guardrails and built-in
accountability** — distinct from signal-alert apps (no execution/accountability),
robo-advisors (passive), rule-based algo platforms (no reasoning), and copy-trading
(opaque). This dashboard makes that moat legible: it is where a user *sees* the frontier
model's reasoning, *sees* the deterministic guardrails catching bad calls (guardrail-trip
panel), and *sees* whether the engine's stated confidence is trustworthy (calibration
panel). Transparency is the reason a user delegates real capital. Calibration and
guardrail-trip analytics in particular are trust signals few or no competitors ship.
