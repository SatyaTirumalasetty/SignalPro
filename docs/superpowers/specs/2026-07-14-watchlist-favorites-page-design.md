# Watchlist (Favorites) Page — Design Spec

**Date:** 2026-07-14
**Status:** Approved (design), pending spec review

## Summary

A dedicated **Watchlist** page where a user browses stocks, searches for
more, and "hearts" them into a personal favorites list. The list is
**browse-only** — it is completely separate from the autonomous engine's
trading universe (`preferences.auto_trading.symbols`). Hearting a stock
**never** arms it for trading.

On first visit the list is **seeded with a curated top-20 large-cap set**.
The user edits one single list freely: un-heart to remove, search + heart to
add. Each row shows the ticker, live price, day change %, a heart toggle, and
a link to the existing `/analyze/:symbol` page.

## Goals

- New `/watchlist` page with a nav entry "Watchlist".
- Seeded with a fixed curated list of 20 large-caps on first visit.
- Search any US symbol (reuse existing `GET /market/search`) and heart to add.
- Heart / un-heart toggles membership in one editable list.
- Each row: ticker, company name (where known), live price, day change %
  (green/red), heart, link to `/analyze/:symbol`.
- Persist per-user, isolated from the trading watchlist.

## Non-Goals (YAGNI)

- Reordering, pinning, drag-and-drop, folders/groups.
- Per-symbol notes or price alerts.
- Live "most-active" seeding (curated constant only; a later phase may swap in
  live most-active).
- Any path that promotes a hearted stock into `auto_trading.symbols`.
- A new database table — the list lives in `users.preferences`.

## Data Model & Storage

The favorites list is stored at `users.preferences.watchlist` as an array of
upper-cased ticker strings, e.g. `["AAPL","MSFT","NVDA"]`. This mirrors the
existing convention of storing user config under `preferences` (the trading
list lives at `preferences.auto_trading.symbols`). No schema migration.

**Seeding semantics (single editable list):**
- If `preferences.watchlist` is **absent/undefined**, the API returns the
  curated 20 seed — but does **not** persist it yet.
- The first mutating call (`PUT /api/watchlist`) persists the full list the
  client sends. From then on the stored value is authoritative, including an
  explicit empty list `[]` (a user who removes everything stays empty; the
  seed does not reappear).
- Distinguishing "never set" (→ seed) from "set to empty" (→ empty) is done by
  key presence, not truthiness.

**Curated seed (frontend + backend share the same 20):** The canonical list of
20 tickers is defined once in the backend (`WATCHLIST_SEED`) and consumed by
the seeding logic. The frontend keeps a display map of `ticker → company name`
for the same 20 (names are presentation-only). Proposed 20 (final list may be
adjusted during implementation, but count stays 20):

```
AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, BRK.B, JPM, V,
UNH, XOM, JNJ, WMT, MA, PG, HD, COST, ORCL, NFLX
```

## API

All endpoints `authenticate`-gated and scoped to `req.user.id`. New router
`backend/src/routes/watchlist.js`, mounted at `/api/watchlist` in `server.js`.

### `GET /api/watchlist`
Returns the user's list, seeding when unset.
```json
{ "symbols": ["AAPL", "MSFT", "NVDA", "..."] }
```
- Reads `preferences.watchlist`. If the key is absent → return `WATCHLIST_SEED`
  (not persisted). If present (including `[]`) → return the stored array.

### `PUT /api/watchlist`
Replace the whole list (the client always sends the new full list — simplest
for a heart/un-heart toggle).
- Body: `{ "symbols": ["AAPL", "MSFT"] }`
- Validation: array of strings; each trimmed, upper-cased, `1–20` chars,
  `^[A-Z0-9.\-]+$`; de-duplicated preserving order; max **100** symbols.
- Writes back to `preferences.watchlist` via a read-modify-write of
  `preferences` (JSONB), preserving all other preference keys (must not clobber
  `auto_trading` or anything else).
- Returns the normalized stored list: `{ "symbols": [...] }`.

Rationale for whole-list PUT over per-symbol POST/DELETE: the UI holds the full
list in state; sending it whole avoids a second round-trip to reconcile and
keeps the endpoint idempotent. The 100-cap bounds the payload.

### `GET /api/market/prices?symbols=A,B,C` (addition to existing market router)
Batch price + day-change for the row data, so the page makes one request
instead of 20.
- Query `symbols`: comma-separated, max 100, each validated like above.
- For each symbol calls the existing `getCurrentPrice(symbol)` (Redis-cached
  ~60s) under `Promise.allSettled`, so one failing symbol does not break the
  response.
- Returns only the symbols that resolved:
```json
{ "prices": [ { "symbol": "AAPL", "price": 205.05, "change_percent": 1.20 } ] }
```
- `optionalAuth` (consistent with the other `/market/*` read endpoints).
- `change_percent` is returned as a number (the service currently returns it as
  a `.toFixed(2)` string — coerce to `Number` at this boundary).

## Frontend

### New page: `frontend/src/pages/watchlist/WatchlistPage.tsx` at `/watchlist`
Layout (top → bottom):
1. Header: "Watchlist" + one-line subtitle noting it's a personal favorites
   list, separate from auto-trading.
2. **Search** (`Input`): debounced query to `GET /market/search`. Results
   render in a dropdown/list; each result shows ticker + name + a heart to add.
   A result already in the list shows a filled heart.
3. **The list**: one row per symbol in the current list —
   `☆/★  TICKER  Company Name   $price   ±change%   [Analyze →]`.
   - Heart filled = in list; click toggles (calls `PUT` with the updated list).
   - Change % green when ≥ 0, red when < 0 (`formatPercent`/existing helpers).
   - "Analyze" links to `/analyze/:symbol`.
   - Empty state when the list is `[]`: a prompt to search and heart a stock.

### State & data
- `useWatchlist()` hook: `useQuery(['watchlist'])` → `GET /api/watchlist`;
  a mutation `PUT /api/watchlist` that optimistically updates the list and
  invalidates `['watchlist']`.
- Prices: `useQuery(['watchlist-prices', symbols])` → `GET /market/prices`
  for the current symbols (initial price + change). Live updates layered via
  the existing `useLivePrices(symbols)` WebSocket hook (same pattern as
  `DashboardPage`); WS last price overrides the batch price when present.
- Company names: from the shared curated `SYMBOL_NAMES` map when known;
  symbols added via search use the name from the search result while on the
  page, and fall back to showing just the ticker after reload (names are not
  persisted — presentation only).

### Curated constant
`frontend/src/lib/watchlist.ts` (or similar) exports the display
`SYMBOL_NAMES` map for the curated 20. The seed source of truth for membership
is the backend `WATCHLIST_SEED`.

### Nav + route
- `frontend/src/router.tsx`: import `WatchlistPage`, add
  `{ path: '/watchlist', element: <WatchlistPage /> }` under `AppLayout`.
- `frontend/src/components/layout/AppLayout.tsx`: add a nav item
  `{ to: '/watchlist', label: 'Watchlist', icon: Heart }` (lucide-react
  `Heart`). The row toggle uses the same `Heart` icon — filled when in the
  list, outline when not — to match the "heart to add" language.

### Types
Append to `frontend/src/types/api.ts`:
```ts
export interface WatchlistResponse { symbols: string[] }
export interface SymbolPrice { symbol: string; price: number; change_percent: number }
export interface MarketPricesResponse { prices: SymbolPrice[] }
```

## Error Handling

- `GET /api/watchlist`: never 500 on a missing key — seed instead.
- `PUT /api/watchlist`: 400 on invalid body (non-array, bad tickers, over cap)
  with `express-validator` errors; on success returns the normalized list.
- `GET /market/prices`: `Promise.allSettled` — partial results are fine; a
  symbol that fails price lookup is simply omitted, and the row shows the
  ticker with a `—` price until WS or a later fetch fills it.
- Frontend heart toggle: optimistic update; on mutation error, roll back and
  show a small inline error/toast, re-enable the heart.

## Testing

**Backend** (`backend/src/__tests__/phase11/`, mirroring existing route tests
with `jest.mock` of database + auth):
- `watchlistRoute.test.js`:
  - GET returns the seed (length 20, contains AAPL) when `preferences` has no
    `watchlist` key.
  - GET returns the stored list when present, including an empty `[]` (does not
    re-seed).
  - PUT normalizes (upper-case, de-dupe, trim), rejects invalid tickers (400),
    rejects > 100 symbols, and preserves other `preferences` keys
    (`auto_trading` untouched) in the write.
- `marketPricesRoute.test.js`:
  - Batch returns one entry per resolvable symbol; a symbol whose
    `getCurrentPrice` rejects is omitted (others still returned);
    `change_percent` is a number.

**Frontend** (`*.test.tsx`, mock `@/lib/api`, mirroring existing page tests):
- `WatchlistPage.test.tsx`:
  - Renders the seeded rows from `GET /api/watchlist` + prices.
  - Clicking a filled heart removes the symbol and calls `PUT` with the
    reduced list.
  - Searching and hearting a result calls `PUT` with the symbol appended.
  - Empty list shows the empty-state prompt.
- `useWatchlist` mutation optimistic-update behavior (if factored into a
  testable hook).

## Files

**Create**
- `backend/src/routes/watchlist.js`
- `backend/src/__tests__/phase11/watchlistRoute.test.js`
- `backend/src/__tests__/phase11/marketPricesRoute.test.js`
- `frontend/src/pages/watchlist/WatchlistPage.tsx`
- `frontend/src/pages/watchlist/WatchlistPage.test.tsx`
- `frontend/src/hooks/useWatchlist.ts`
- `frontend/src/lib/watchlist.ts` (curated `SYMBOL_NAMES` display map)

**Modify**
- `backend/src/routes/market.js` (add the `GET /prices` batch handler only —
  it does not need the seed constant).
- `backend/src/server.js` (mount `/api/watchlist`)

`WATCHLIST_SEED` (the 20 tickers) is defined and exported from
`backend/src/routes/watchlist.js`; only that router consumes it.
- `frontend/src/router.tsx` (route)
- `frontend/src/components/layout/AppLayout.tsx` (nav item)
- `frontend/src/types/api.ts` (new interfaces)

## Open Questions / Decisions Made

- **List vs trading watchlist:** separate; hearting is browse-only. ✅
- **Location:** dedicated `/watchlist` page + nav item. ✅
- **Seed semantics:** single editable list, seeded with 20 on first visit;
  empty stays empty. ✅
- **Seed source:** fixed curated large-cap constant (not live most-active). ✅
- **Mutation shape:** whole-list `PUT`. ✅
- **Prices:** new batch `GET /market/prices` + existing WS live updates. ✅
