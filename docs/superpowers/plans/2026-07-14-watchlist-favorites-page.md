# Watchlist (Favorites) Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browse-only `/watchlist` page where a user searches stocks and "hearts" them into a personal favorites list, seeded with a curated top-20 large-cap set, fully separate from the auto-trading symbols.

**Architecture:** A new read/replace `watchlist` router stores the list at `users.preferences.watchlist` (JSONB, isolated from `auto_trading`). `GET` seeds the curated 20 when the key is absent; `PUT` replaces the whole list. A small batch `GET /market/prices` endpoint supplies price + day-change for the rows in one request, reusing the Redis-cached `getCurrentPrice`. A new React page composes a search box, the row list, and heart toggles, with live prices layered via the existing WebSocket hook.

**Tech Stack:** Backend — Express, `pg-promise` (`db.one`), `express-validator`, Jest + Supertest. Frontend — React, `react-router-dom`, `@tanstack/react-query`, TypeScript, Tailwind, shadcn-style primitives in `src/components/ui/`, lucide-react icons, Vitest + Testing Library.

## Global Constraints

- New backend endpoints are `authenticate`-gated (watchlist) or `optionalAuth` (market prices, matching sibling `/market/*` reads) and scope every query to `req.user.id` where applicable.
- Persist the favorites list at `users.preferences.watchlist` **only**. Never read or write `preferences.auto_trading` from watchlist code. Writes use `jsonb_set(COALESCE(preferences,'{}'::jsonb), '{watchlist}', $1::jsonb)` so sibling preference keys are preserved.
- Seed semantics: absent key → return `WATCHLIST_SEED` (not persisted); present array (including `[]`) → return it verbatim. Distinguish by `Array.isArray(...)`, never truthiness.
- Ticker validation everywhere: trimmed, upper-cased, 1–20 chars, `^[A-Z0-9.\-]+$`; de-duplicate preserving order; cap the list at **100** symbols.
- `getCurrentPrice(symbol)` returns `change_percent` as a `.toFixed(2)` **string** — coerce with `Number(...)` at the `/market/prices` boundary so the API returns a number.
- Day-change % renders with a direct `${v>=0?'+':''}${v.toFixed(2)}%` helper, NOT `formatPercent` (which multiplies values ≤1 by 100 and would turn a real 0.5% change into 50%).
- Backend tests go under `backend/src/__tests__/phase11/`, mirroring the existing route tests (Supertest app + `jest.mock('../../config/database')` + `jest.mock('../../middleware/auth')`).
- Frontend tests are colocated `*.test.tsx`, mirroring `MarketPage.test.tsx` (mock `@/lib/api`, mock `@/hooks/useWebSocket`).
- Run backend tests: `cd backend && npx jest <path>`. Frontend: `cd frontend && npx vitest run <path>`.

---

### Task 1: Backend `watchlist` router — `GET` (seeded) + `PUT` (replace)

**Files:**
- Create: `backend/src/routes/watchlist.js`
- Modify: `backend/src/server.js` (mount the router)
- Test: `backend/src/__tests__/phase11/watchlistRoute.test.js`

**Interfaces:**
- Consumes: `db` from `../config/database`, `authenticate` from `../middleware/auth`, `asyncHandler` from `../middleware/errorHandler`, `body`/`validationResult` from `express-validator`.
- Produces:
  - `GET /api/watchlist` → `{ "symbols": string[] }`
  - `PUT /api/watchlist` (body `{ symbols: string[] }`) → `{ "symbols": string[] }`
  - Exported constant `WATCHLIST_SEED: string[]` (length 20) for reuse/tests.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase11/watchlistRoute.test.js`:

```js
const request = require('supertest');
const express = require('express');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

const watchlistRouter = require('../../routes/watchlist');
const app = express();
app.use(express.json());
app.use('/api/watchlist', watchlistRouter);

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/watchlist', () => {
  test('seeds the curated 20 when preferences has no watchlist key', async () => {
    mockDb.one.mockResolvedValue({ preferences: {} });
    const res = await request(app).get('/api/watchlist');
    expect(res.status).toBe(200);
    expect(res.body.symbols).toHaveLength(20);
    expect(res.body.symbols).toContain('AAPL');
  });

  test('returns the stored list when present', async () => {
    mockDb.one.mockResolvedValue({ preferences: { watchlist: ['NVDA', 'TSLA'] } });
    const res = await request(app).get('/api/watchlist');
    expect(res.body.symbols).toEqual(['NVDA', 'TSLA']);
  });

  test('returns an empty list verbatim (does not re-seed)', async () => {
    mockDb.one.mockResolvedValue({ preferences: { watchlist: [] } });
    const res = await request(app).get('/api/watchlist');
    expect(res.body.symbols).toEqual([]);
  });
});

describe('PUT /api/watchlist', () => {
  test('normalizes (upper-case, trim, de-dupe) and writes only the watchlist key', async () => {
    mockDb.one.mockResolvedValue({ preferences: { watchlist: ['AAPL', 'MSFT'] } });
    const res = await request(app).put('/api/watchlist').send({ symbols: [' aapl ', 'MSFT', 'aapl'] });
    expect(res.status).toBe(200);
    const [sql, params] = mockDb.one.mock.calls[0];
    expect(sql).toContain("'{watchlist}'");
    expect(sql).toContain('jsonb_set');
    expect(JSON.parse(params[0])).toEqual(['AAPL', 'MSFT']); // trimmed, upper, de-duped
    expect(res.body.symbols).toEqual(['AAPL', 'MSFT']);
  });

  test('rejects an invalid ticker with 400', async () => {
    const res = await request(app).put('/api/watchlist').send({ symbols: ['AA PL'] });
    expect(res.status).toBe(400);
    expect(mockDb.one).not.toHaveBeenCalled();
  });

  test('rejects more than 100 symbols with 400', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `SYM${i}`);
    const res = await request(app).put('/api/watchlist').send({ symbols: many });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/phase11/watchlistRoute.test.js`
Expected: FAIL — cannot find module `../../routes/watchlist`.

- [ ] **Step 3: Implement the router**

Create `backend/src/routes/watchlist.js`:

```js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Curated top-20 large-caps. Seeded once on a user's first visit; membership
// source of truth for the frontend (which keeps its own display-name map).
const WATCHLIST_SEED = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK.B', 'JPM', 'V',
  'UNH', 'XOM', 'JNJ', 'WMT', 'MA', 'PG', 'HD', 'COST', 'ORCL', 'NFLX',
];

const TICKER_RE = /^[A-Z0-9.\-]+$/;

// ── GET /api/watchlist ────────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const user = await db.one('SELECT preferences FROM users WHERE id = $1', [req.user.id]);
  const wl = user.preferences?.watchlist;
  res.json({ symbols: Array.isArray(wl) ? wl : WATCHLIST_SEED });
}));

// ── PUT /api/watchlist ────────────────────────────────────────────────────────
// Replace the whole list. The client always sends the new full list.
router.put('/', authenticate, [
  body('symbols').isArray({ max: 100 }),
  body('symbols.*').isString().trim().toUpperCase().isLength({ min: 1, max: 20 }).matches(TICKER_RE),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  // De-duplicate preserving order (values already trimmed/upper-cased by the sanitizer).
  const seen = new Set();
  const symbols = [];
  for (const s of req.body.symbols) {
    if (!seen.has(s)) { seen.add(s); symbols.push(s); }
  }

  const updated = await db.one(
    `UPDATE users
       SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{watchlist}', $1::jsonb),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING preferences`,
    [JSON.stringify(symbols), req.user.id]
  );

  res.json({ symbols: updated.preferences.watchlist });
}));

module.exports = router;
module.exports.WATCHLIST_SEED = WATCHLIST_SEED;
```

- [ ] **Step 4: Mount the router in `server.js`**

In `backend/src/server.js`, next to the other `app.use('/api/...')` mounts (near line 77 where `marketRoutes` is mounted), add:

```js
app.use('/api/watchlist', require('./routes/watchlist'));
```

(If the file mounts routers via top-of-file `require` + a named variable, follow that style instead: add `const watchlistRoutes = require('./routes/watchlist');` with the other route requires and `app.use('/api/watchlist', watchlistRoutes);` with the other mounts.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/phase11/watchlistRoute.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/watchlist.js backend/src/server.js backend/src/__tests__/phase11/watchlistRoute.test.js
git commit -m "feat: watchlist favorites endpoint (seeded GET + whole-list PUT)"
```

---

### Task 2: Backend `GET /api/market/prices` batch endpoint

**Files:**
- Modify: `backend/src/routes/market.js` (add handler; `getCurrentPrice` is already imported)
- Test: `backend/src/__tests__/phase11/marketPricesRoute.test.js`

**Interfaces:**
- Consumes: existing `getCurrentPrice` from `../services/marketData`, `query`/`validationResult`, `optionalAuth`, `asyncHandler`.
- Produces: `GET /api/market/prices?symbols=A,B,C` → `{ "prices": [ { "symbol": "AAPL", "price": 205.05, "change_percent": 1.2 } ] }`. Only symbols whose price resolves are included; `change_percent` is a number.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase11/marketPricesRoute.test.js`:

```js
const request = require('supertest');
const express = require('express');

jest.mock('../../services/marketData', () => ({
  getCurrentPrice: jest.fn(),
  getLiveQuote: jest.fn(),
  getHistoricalData: jest.fn(),
  getHistoricalPage: jest.fn(),
  searchSymbols: jest.fn(),
}));
jest.mock('../../services/indicators', () => ({ calculateAll: jest.fn() }));
jest.mock('../../middleware/auth', () => ({ optionalAuth: (_req, _res, next) => next() }));

const { getCurrentPrice } = require('../../services/marketData');
const marketRouter = require('../../routes/market');
const app = express();
app.use(express.json());
app.use('/api/market', marketRouter);

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/market/prices', () => {
  test('returns price + numeric change_percent per resolvable symbol', async () => {
    getCurrentPrice.mockImplementation((sym) => {
      if (sym === 'AAPL') return Promise.resolve({ symbol: 'AAPL', price: 205.05, change_percent: '1.20' });
      if (sym === 'MSFT') return Promise.resolve({ symbol: 'MSFT', price: 410.1, change_percent: '-0.30' });
      return Promise.reject(new Error('not found'));
    });
    const res = await request(app).get('/api/market/prices?symbols=AAPL,MSFT');
    expect(res.status).toBe(200);
    expect(res.body.prices).toEqual([
      { symbol: 'AAPL', price: 205.05, change_percent: 1.2 },
      { symbol: 'MSFT', price: 410.1, change_percent: -0.3 },
    ]);
  });

  test('omits a symbol whose price lookup fails but still returns the others', async () => {
    getCurrentPrice.mockImplementation((sym) =>
      sym === 'AAPL'
        ? Promise.resolve({ symbol: 'AAPL', price: 205.05, change_percent: '1.20' })
        : Promise.reject(new Error('boom')));
    const res = await request(app).get('/api/market/prices?symbols=AAPL,BADSYM');
    expect(res.status).toBe(200);
    expect(res.body.prices).toEqual([{ symbol: 'AAPL', price: 205.05, change_percent: 1.2 }]);
  });

  test('400 when symbols is missing', async () => {
    const res = await request(app).get('/api/market/prices');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/phase11/marketPricesRoute.test.js`
Expected: FAIL — `/prices` route not defined (404), assertion errors.

- [ ] **Step 3: Implement the handler**

In `backend/src/routes/market.js`, add this handler immediately after the `GET /search` handler (before `GET /price/:symbol`), so the literal `prices` path is registered near the other reads:

```js
// GET /api/market/prices?symbols=AAPL,MSFT — batch price + day-change for a watchlist
router.get('/prices', optionalAuth, [
  query('symbols').trim().notEmpty().isLength({ max: 2000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const symbols = [...new Set(
    req.query.symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  )].slice(0, 100);

  const settled = await Promise.allSettled(symbols.map((s) => getCurrentPrice(s)));
  const prices = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      prices.push({ symbol: symbols[i], price: r.value.price, change_percent: Number(r.value.change_percent) });
    }
  });

  res.json({ prices });
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/phase11/marketPricesRoute.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/market.js backend/src/__tests__/phase11/marketPricesRoute.test.js
git commit -m "feat: batch /market/prices endpoint for watchlist rows"
```

---

### Task 3: Frontend — types, names map, hook, page (seeded list + prices), route, nav

Delivers a navigable `/watchlist` page that renders the seeded rows with prices. Heart-toggle + search interactions come in Task 4.

**Files:**
- Modify: `frontend/src/types/api.ts` (append interfaces)
- Create: `frontend/src/lib/watchlist.ts` (display-name map)
- Create: `frontend/src/hooks/useWatchlist.ts` (query + mutation hooks)
- Create: `frontend/src/pages/watchlist/WatchlistPage.tsx`
- Modify: `frontend/src/router.tsx` (import + route)
- Modify: `frontend/src/components/layout/AppLayout.tsx` (nav item)
- Test: `frontend/src/pages/watchlist/WatchlistPage.test.tsx`

**Interfaces:**
- Produces (types):
  ```ts
  export interface WatchlistResponse { symbols: string[] }
  export interface SymbolPrice { symbol: string; price: number; change_percent: number }
  export interface MarketPricesResponse { prices: SymbolPrice[] }
  ```
- Produces (hooks): `useWatchlist(): UseQueryResult<string[]>` (key `['watchlist']`); `useWatchlistMutation()` — a mutation taking the full `string[]` and PUT-ing it, with optimistic update of `['watchlist']`.
- Produces (component): `WatchlistPage` (no props).
- Produces (map): `SYMBOL_NAMES: Record<string, string>` for the curated 20.

- [ ] **Step 1: Append types to `frontend/src/types/api.ts`**

Add to the end of the file:

```ts
export interface WatchlistResponse {
  symbols: string[]
}
export interface SymbolPrice {
  symbol: string
  price: number
  change_percent: number
}
export interface MarketPricesResponse {
  prices: SymbolPrice[]
}
```

- [ ] **Step 2: Create the display-name map `frontend/src/lib/watchlist.ts`**

```ts
// Display-only company names for the curated seed. Membership itself is owned
// by the backend WATCHLIST_SEED; symbols added via search that aren't here
// simply render as their ticker.
export const SYMBOL_NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', AMZN: 'Amazon', GOOGL: 'Alphabet',
  META: 'Meta Platforms', TSLA: 'Tesla', 'BRK.B': 'Berkshire Hathaway', JPM: 'JPMorgan Chase', V: 'Visa',
  UNH: 'UnitedHealth', XOM: 'Exxon Mobil', JNJ: 'Johnson & Johnson', WMT: 'Walmart', MA: 'Mastercard',
  PG: 'Procter & Gamble', HD: 'Home Depot', COST: 'Costco', ORCL: 'Oracle', NFLX: 'Netflix',
}
```

- [ ] **Step 3: Create the hook `frontend/src/hooks/useWatchlist.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { WatchlistResponse } from '@/types/api'

export function useWatchlist() {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: async () => (await api.get<WatchlistResponse>('/watchlist')).data.symbols,
  })
}

export function useWatchlistMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (symbols: string[]) =>
      (await api.put<WatchlistResponse>('/watchlist', { symbols })).data.symbols,
    onMutate: async (symbols) => {
      await qc.cancelQueries({ queryKey: ['watchlist'] })
      const prev = qc.getQueryData<string[]>(['watchlist'])
      qc.setQueryData(['watchlist'], symbols)
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['watchlist'], ctx.prev) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['watchlist'] }) },
  })
}
```

- [ ] **Step 4: Write the failing page test**

Create `frontend/src/pages/watchlist/WatchlistPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { WatchlistPage } from './WatchlistPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), put: vi.fn() } }))
vi.mock('@/hooks/useWebSocket', () => ({ useLivePrices: () => ({}) }))

function mockGet(symbols = ['AAPL', 'MSFT']) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/watchlist') return Promise.resolve({ data: { symbols } })
    if (url === '/market/prices') return Promise.resolve({ data: { prices: [
      { symbol: 'AAPL', price: 205.05, change_percent: 1.2 },
      { symbol: 'MSFT', price: 410.1, change_percent: -0.3 },
    ] } })
    if (url === '/market/search') return Promise.resolve({ data: { results: [] } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><WatchlistPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.clearAllMocks() })

describe('WatchlistPage', () => {
  test('renders a row per watchlist symbol with price and day change', async () => {
    mockGet()
    renderPage()
    expect(await screen.findByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple')).toBeInTheDocument()
    expect(screen.getByText('$205.05')).toBeInTheDocument()
    expect(screen.getByText('+1.20%')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.getByText('-0.30%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/watchlist/WatchlistPage.test.tsx`
Expected: FAIL — cannot resolve `./WatchlistPage`.

- [ ] **Step 6: Implement `frontend/src/pages/watchlist/WatchlistPage.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Heart } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useLivePrices } from '@/hooks/useWebSocket'
import { formatCurrency } from '@/lib/format'
import { SYMBOL_NAMES } from '@/lib/watchlist'
import { useWatchlist, useWatchlistMutation } from '@/hooks/useWatchlist'
import type { MarketPricesResponse, SearchResult } from '@/types/api'

// Day-change % is already a percent (e.g. 1.2, 0.5). Render directly — do NOT
// use formatPercent, which multiplies values ≤1 by 100.
const changePct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

export function WatchlistPage() {
  const { data: symbols = [] } = useWatchlist()
  const mutation = useWatchlistMutation()
  const [query, setQuery] = useState('')

  const search = useQuery({
    queryKey: ['market-search', query],
    queryFn: async () => (await api.get<{ results: SearchResult[] }>('/market/search', { params: { q: query } })).data.results,
    enabled: query.trim().length > 1,
  })

  const pricesQuery = useQuery({
    queryKey: ['watchlist-prices', symbols],
    queryFn: async () => (await api.get<MarketPricesResponse>('/market/prices', { params: { symbols: symbols.join(',') } })).data.prices,
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
  })
  const priceMap = useMemo(
    () => new Map((pricesQuery.data ?? []).map((p) => [p.symbol, p])),
    [pricesQuery.data],
  )
  const live = useLivePrices(symbols)

  const toggle = (sym: string) => {
    const next = symbols.includes(sym) ? symbols.filter((s) => s !== sym) : [...symbols, sym]
    mutation.mutate(next)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Watchlist</h1>
        <p className="text-sm text-muted">Your personal favorites for browsing prices &amp; signals — separate from what the engine trades.</p>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input placeholder="Search symbol or company…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
        {search.data && search.data.length > 0 && query.trim().length > 1 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
            {search.data.map((result) => (
              <button
                key={result.symbol}
                onClick={() => { toggle(result.symbol); setQuery('') }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground hover:bg-primary/10 cursor-pointer"
              >
                <span><span className="font-medium">{result.symbol}</span> <span className="text-muted">{result.name}</span></span>
                <Heart size={16} className={symbols.includes(result.symbol) ? 'fill-danger text-danger' : 'text-muted'} />
              </button>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col divide-y divide-border p-0">
          {symbols.length === 0 && (
            <p className="p-4 text-sm text-muted">Your watchlist is empty. Search above and tap the heart to add a stock.</p>
          )}
          {symbols.map((sym) => {
            const p = priceMap.get(sym)
            const price = live[sym]?.price ?? p?.price
            const change = live[sym]?.change_percent ?? p?.change_percent
            return (
              <div key={sym} className="flex items-center gap-4 px-4 py-3">
                <button onClick={() => toggle(sym)} aria-label={`Remove ${sym}`} className="shrink-0">
                  <Heart size={18} className="fill-danger text-danger" />
                </button>
                <Link to={`/analyze/${sym}`} className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{sym}</div>
                  <div className="truncate text-xs text-muted">{SYMBOL_NAMES[sym] ?? ''}</div>
                </Link>
                <div className="text-right text-sm font-medium text-foreground">{price != null ? formatCurrency(price) : '—'}</div>
                {change != null && (
                  <Badge variant={change >= 0 ? 'success' : 'danger'} className="w-20 justify-center">{changePct(change)}</Badge>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 7: Register the route in `frontend/src/router.tsx`**

Add the import with the other page imports:

```tsx
import { WatchlistPage } from '@/pages/watchlist/WatchlistPage'
```

Add the route inside the `AppLayout` children array, immediately after the `/market` route:

```tsx
          { path: '/watchlist', element: <WatchlistPage /> },
```

- [ ] **Step 8: Add the nav entry in `frontend/src/components/layout/AppLayout.tsx`**

Add `Heart` to the `lucide-react` import list, then add this item to `navItems` immediately after the `/market` entry:

```tsx
  { to: '/watchlist', label: 'Watchlist', icon: Heart },
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/watchlist/WatchlistPage.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/lib/watchlist.ts frontend/src/hooks/useWatchlist.ts frontend/src/pages/watchlist/WatchlistPage.tsx frontend/src/pages/watchlist/WatchlistPage.test.tsx frontend/src/router.tsx frontend/src/components/layout/AppLayout.tsx
git commit -m "feat: watchlist page scaffold with seeded rows, prices, route and nav"
```

---

### Task 4: Frontend — heart toggle (remove) + search-to-add interactions

Adds behavioral tests for the toggle and search-add paths already wired in Task 3, plus the empty-state assertion. This task is test-only if Task 3's implementation is correct; if a test fails, fix the component to satisfy it.

**Files:**
- Modify: `frontend/src/pages/watchlist/WatchlistPage.test.tsx` (add interaction tests)
- Modify (if needed): `frontend/src/pages/watchlist/WatchlistPage.tsx`

**Interfaces:**
- Consumes: `useWatchlistMutation` (PUT), the page from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Add the failing interaction tests**

Append these tests inside the `describe('WatchlistPage', ...)` block in `frontend/src/pages/watchlist/WatchlistPage.test.tsx`:

```tsx
  test('un-hearting a row PUTs the reduced list', async () => {
    mockGet(['AAPL', 'MSFT'])
    ;(api.put as Mock).mockResolvedValue({ data: { symbols: ['MSFT'] } })
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('AAPL')
    await user.click(screen.getByLabelText('Remove AAPL'))
    expect(api.put).toHaveBeenCalledWith('/watchlist', { symbols: ['MSFT'] })
  })

  test('searching and hearting a result PUTs the appended list', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/watchlist') return Promise.resolve({ data: { symbols: ['AAPL'] } })
      if (url === '/market/prices') return Promise.resolve({ data: { prices: [{ symbol: 'AAPL', price: 205.05, change_percent: 1.2 }] } })
      if (url === '/market/search') return Promise.resolve({ data: { results: [{ symbol: 'NVDA', name: 'NVIDIA', type: 'stock' }] } })
      return Promise.resolve({ data: {} })
    })
    ;(api.put as Mock).mockResolvedValue({ data: { symbols: ['AAPL', 'NVDA'] } })
    renderPage()
    const user = userEvent.setup()
    await screen.findByText('AAPL')
    await user.type(screen.getByPlaceholderText('Search symbol or company…'), 'nvi')
    await user.click(await screen.findByText('NVIDIA'))
    expect(api.put).toHaveBeenCalledWith('/watchlist', { symbols: ['AAPL', 'NVDA'] })
  })

  test('shows the empty state when the list is empty', async () => {
    mockGet([])
    renderPage()
    expect(await screen.findByText(/your watchlist is empty/i)).toBeInTheDocument()
  })
```

Add the `userEvent` import at the top of the test file if not already present:

```tsx
import userEvent from '@testing-library/user-event'
```

- [ ] **Step 2: Run tests to verify (new ones may already pass)**

Run: `cd frontend && npx vitest run src/pages/watchlist/WatchlistPage.test.tsx`
Expected: All pass if Task 3's page is correct. If the search-add or remove test fails, adjust the component (e.g. the `toggle` handler or the `aria-label`) until the tests pass — do not weaken the tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/watchlist/WatchlistPage.test.tsx frontend/src/pages/watchlist/WatchlistPage.tsx
git commit -m "test: watchlist heart-toggle and search-to-add interactions"
```

---

## Verification

After Task 4, run the whole affected suites and a typecheck:

```bash
cd backend && npx jest src/__tests__/phase11
cd frontend && npx vitest run src/pages/watchlist src/hooks
cd frontend && npx tsc --noEmit
```

Then drive the page in the app (per the `run`/`verify` skill): with the stack running, navigate to `/watchlist`, confirm the seeded 20 render with prices and day-change, that searching a symbol shows results, that hearting adds it and un-hearting removes it (and the change persists across a reload), and that a row links to `/analyze/:symbol`. Confirm the Auto Trading watchlist (`/auto-trading`) is unchanged by any of this.

## Notes for the implementer

- **`preferences` isolation:** the PUT uses `jsonb_set(..., '{watchlist}', ...)`, which sets only the `watchlist` key. Never `SELECT` the whole preferences and write it back for the watchlist — that risks clobbering `auto_trading`.
- **Empty vs unset:** `GET` distinguishes `Array.isArray(wl)` (present, even `[]`) from absent (→ seed). Do not use `wl?.length` or truthiness, or an intentionally-emptied list would re-seed.
- **Change % helper:** use the local `changePct` (`${v>=0?'+':''}${v.toFixed(2)}%`). `formatPercent` from `@/lib/format` will mis-scale sub-1% changes (it multiplies values ≤1 by 100).
- **Route order (backend):** `/prices` is registered before `/price/:symbol`; they are distinct literals so order is not strictly required, but keeping `/prices` next to `/search` avoids confusion.
- **Live prices:** `useLivePrices(symbols)` returns `Record<string, { price?, change_percent? }>`; the WS value overrides the batch value when present (same pattern as `MarketPage`/`DashboardPage`).
