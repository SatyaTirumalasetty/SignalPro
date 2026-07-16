# Symbol Analysis Page: Advanced Charting + One-Click Trading — Design

**Date:** 2026-07-10
**Status:** Approved by user (brainstorming session 2026-07-10)
**Depends on:** engine v2 (PR #2) — reuses `placeOrder` bracket path, `riskManagement.calculatePositionSize`, `historical_signals`, user preferences plumbing.

## Goal

Give the user one destination to **verify the AI's analysis visually and act on it**: a pro-grade chart with a universal indicator set built into the platform (no third-party charting dependency beyond the open-source lightweight-charts renderer), the AI signal drawn on the chart, and a trade ticket that places bracket orders in one or two clicks. Data loading is engineered for perceived zero latency.

## Non-goals (v1)

- Drawing tools (trendlines, fib retracements, annotations) — **v2**; lightweight-charts has no built-in drawing layer and a hand-rolled one is its own project.
- Options trading, multi-leg orders, or order types beyond market/limit with bracket SL/TP.
- The observability/monitor dashboard (separately brainstormed; parked).
- Sub-minute timeframes or tick charts (data source granularity floor is 1m).

## 1. Page, routing, entry points

- New route `/analyze/:symbol` → `SymbolAnalysisPage` (protected).
- Layout: chart area left (~70%, fills viewport height minus header), right panel (~30%) stacking:
  1. **AI signal summary** — action badge, confidence, reasoning, invalidation, timeframe-alignment chips, signal age.
  2. **Trade ticket** (section 5).
- Entry points:
  - Signal cards (Dashboard, Signals pages) gain **Buy/Sell buttons** and the card body links to `/analyze/:symbol?signal=<id>`.
  - Market page rows and Auto Trading watchlist chips link to `/analyze/:symbol`.
- Without `?signal=`, the page fetches the symbol's most recent non-expired signal; if none, chart-only with a blank ticket.

## 2. Data path (built for speed)

### Endpoint

`GET /api/market/candles/:symbol?timeframe=<1m|5m|15m|1h|4h|1d>&limit=<n>&before=<ts>`
→ `{ symbol, timeframe, candles: [{ time, open, high, low, close, volume }], current_price, previous_close }`

- Serves **raw candles only** — indicator math happens client-side (section 3).
- `before` cursor pages older history for infinite pan-back.
- Backed by the existing market-data service (Alpaca history API).

### Latency engineering

| Layer | Mechanism |
|---|---|
| Server cache | Redis-cache candle pages. Closed-period candles are immutable → long TTL keyed by `(symbol, timeframe, page)`; only the forming candle is volatile (short TTL or merged from live stream). |
| Client cache | React Query with generous `staleTime` for historical pages; keyed identically. |
| Prefetch | Hovering a signal card / symbol row triggers `queryClient.prefetchQuery` for that symbol's default-timeframe candles — click paints from cache. |
| Live updates | New WebSocket channel `candles:<symbol>:<timeframe>` pushes forming-candle updates; chart applies via `series.update()` (no refetch, no poll). Reuses the existing WS server. |
| Incremental history | Initial load ~300 candles; `onVisibleLogicalRangeChange` near left edge lazy-loads the next `before` page and prepends. |

Honest floor: cold-path latency = one Alpaca round trip. Everything after first fetch is local or cached.

## 3. Advanced charting engine

### Foundation

lightweight-charts (already a dependency; canvas renderer, 100k+ candles). All indicator logic, pane management, and overlays are ours — no external charting platform.

### Client-side indicator library (`frontend/src/lib/indicators/`)

Pure TypeScript functions, `(candles, params) → series aligned to candles` (leading nulls where the window is unfilled).

| Type | Indicators (v1 catalog) |
|---|---|
| Overlays (on price) | SMA, EMA, WMA (arbitrary period, **multiple instances**), Bollinger Bands, VWAP, Keltner Channels, Parabolic SAR, SuperTrend |
| Panes (stacked below) | Volume (always on), RSI, MACD, Stochastic, ATR, OBV |

- Adding/removing/re-parameterizing an indicator is pure local math → instant redraw, zero network.
- **Parity guarantee:** fixture candles are run through backend `indicators.js` (what the AI sees) and the outputs are committed as JSON fixtures; frontend library tests assert identical values on the shared indicators (SMA, EMA, RSI, MACD, Bollinger, VWAP, ATR, Stochastic). The chart can never disagree with the engine.

### Chart features (v1)

- Multi-pane layout, drag-resizable pane heights.
- Crosshair with full OHLCV + per-indicator readout legend.
- Log/linear price scale toggle; fullscreen mode.
- Timeframe tabs: 1m, 5m, 15m, 1h, 4h, 1d.
- Indicator manager UI: add instance → pick params → toggle visibility → remove.
- **Saved layouts:** the active indicator set + params persist per user in `preferences.chart_layout` (JSONB, existing preferences plumbing); the chart opens configured the user's way.

### AI signal overlay

When a signal is loaded: horizontal price lines for **entry (blue solid), stop-loss (red dashed), take-profit (green dashed)**, labeled with values; toggleable like any indicator. Signal markers (arrow up/down at signal candle time) for the symbol's recent signals.

## 4. Backend additions

- `GET /api/market/candles/:symbol` (above) with Redis caching + cursor pagination.
- WebSocket candle channel: subscribe/unsubscribe messages `{ type: 'subscribe_candles', symbol, timeframe }`; server bridges Alpaca stream (or 5s poll fallback when stream unavailable) into forming-candle pushes.
- `GET /api/signals/latest/:symbol` — most recent non-expired signal for the symbol (thin query over `historical_signals`) if an equivalent doesn't already exist.
- No schema changes.

## 5. Trade ticket + one-click semantics

- Pre-fills from the loaded signal: side (buy for long, sell for short), stop-loss, take-profit, and **quantity pre-sized by `risk_per_trade_pct` against live account equity** using the same `calculatePositionSize` as the engine. Every field editable. Order type market (default) or limit.
- Shows estimated cost/proceeds and the account's buying power.
- Submits through the existing `placeOrder` path (bracket SL/TP identical to engine orders) with `signalId` for signal-performance linkage and `source: 'manual'`.
- **Configurable immediacy** — `preferences.trading.instant_orders` boolean, default `false`:
  - **Off:** card Buy/Sell navigates to `/analyze/:symbol?signal=<id>&arm=1`; ticket is armed; one **Confirm** click places the order.
  - **On:** card Buy/Sell places the risk-sized bracket order immediately; toast with order link. The analysis page's own ticket **always** requires Confirm — instant mode affects only the card shortcut.
- Toggle rendered in the ticket footer ("Instant orders from signal cards"), persisted via the existing preferences update endpoint.

## 6. Error handling

- Broker rejection → toast with the broker's message; ticket stays open with values intact.
- Expired signal (`expires_at` passed) → amber banner "Signal expired — prices may be stale"; trading not blocked.
- Equity fetch failure → quantity left blank with hint ("couldn't size from account equity"); no guessed sizing.
- Instant-mode failure → prominent error toast (no ticket is open to show state).
- WebSocket drop → chart falls back to 15s polling for the forming candle; reconnects with backoff.

## 7. Testing

- **Indicator parity:** generate fixtures from backend `indicators.js`; frontend tests assert identical series values. New backend script `npm run gen:indicator-fixtures` (dev-only).
- **Backend:** route tests — candle shape, pagination cursor, cache headers/behavior (mock redis), latest-signal endpoint.
- **Frontend:** page tests with mocked chart module (render, signal prefill from query param, timeframe switch refetch); ticket tests (risk sizing math, editability, submit payload with SL/TP/signalId, expired-signal banner); instant-mode tests (card button posts immediately when on / navigates when off); indicator library unit tests (window edges, null leading values); layout persistence tests.
- **Manual verification:** paper-account order placed from a real signal via ticket and via instant mode; chart parity spot-check against engine logs for one symbol.

## v2 backlog (recorded, not designed)

Drawing tools (trendlines, fibs), indicator alerts, chart-based order placement (drag SL/TP lines to modify open orders), multi-symbol layout, observability/monitor dashboard.
