# Symbol Analysis Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/analyze/:symbol` page with pro-grade charting (client-side universal indicator library, multi-pane, live candles), the AI signal drawn on the chart, and a risk-sized trade ticket with configurable one-click ordering — plus a fix so open orders can be cancelled.

**Architecture:** Backend serves raw candles fast (existing `/api/market/history` extended with a `before` cursor over a Redis-cached full-range fetch). All indicator math runs client-side in a TypeScript library whose outputs are parity-tested against backend `indicators.js` fixtures. The chart builds on lightweight-charts v5 panes. Orders reuse the existing `POST /api/trading/orders` bracket path.

**Tech Stack:** Node/Express + Jest (backend), React 18 + TypeScript + Vite + Vitest + Testing Library + TanStack Query + lightweight-charts 5.2 (frontend), Tailwind with the app's theme tokens.

**Spec:** `docs/superpowers/specs/2026-07-10-symbol-analysis-trading-design.md`

## Global Constraints

- TDD every task: failing test → implement → pass → commit. Never commit with a failing suite.
- Backend tests: `cd backend && npx jest <pattern> --coverage=false`. Frontend: `cd frontend && npx vitest run <path>`.
- Frontend styling uses existing theme classes (`bg-card`, `border-border`, `text-foreground`, `text-muted`, `text-danger`, `text-success`, `text-primary`) and existing primitives from `frontend/src/components/ui/`.
- API client is `api` from `@/lib/api` (axios; paths WITHOUT `/api` prefix, e.g. `api.get('/market/history/AAPL')`).
- Order body fields are snake_case (`broker_connection_id`, `stop_loss`, `take_profit`, `signal_id`, `order_type`).
- lightweight-charts v5 API: `createChart`, `chart.addSeries(SeriesDefinition, options, paneIndex?)`, `series.setData`, `series.update`, `series.createPriceLine`. Verify against `frontend/node_modules/lightweight-charts/dist/typings.d.ts` if a call errors — do not downgrade to v4 API (`addLineSeries` etc. do not exist).
- Existing suites must stay green: backend 41 suites / frontend 33 files at plan time.
- Commit messages: `feat:`/`fix:`/`test:` prefix, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Cancel button for open and partially-filled orders

The backend `DELETE /api/trading/orders/:id` already cancels any order (broker + DB). The Orders page only shows the Cancel button for `pending` status, hiding it for `open`/`partially_filled` — the states a resting order actually sits in.

**Files:**
- Modify: `frontend/src/pages/trading/OrdersPage.tsx` (cancel-button condition, ~line 103)
- Test: `frontend/src/pages/trading/OrdersPage.test.tsx` (extend)

**Interfaces:**
- Consumes: existing `cancelMutation` in OrdersPage (calls `api.delete('/trading/orders/' + id)`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test** — append to the existing `describe` in `OrdersPage.test.tsx`, following its existing mock pattern (look at the top of the file for how orders are mocked; reuse the same fixture builder, adding rows with `status: 'open'` and `status: 'partially_filled'`):

```tsx
test('shows Cancel for open and partially_filled orders, not for filled', async () => {
  mockApiGet({
    orders: [
      makeOrder({ id: 'o1', status: 'open' }),
      makeOrder({ id: 'o2', status: 'partially_filled' }),
      makeOrder({ id: 'o3', status: 'filled' }),
    ],
  })
  renderPage()
  const cancelButtons = await screen.findAllByRole('button', { name: 'Cancel' })
  expect(cancelButtons).toHaveLength(2)
})
```

If the file has no `makeOrder`/`mockApiGet` helpers, inline three order objects matching the file's existing fixture shape (copy an existing order literal from the file and vary `id`/`status`).

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npx vitest run src/pages/trading/OrdersPage.test.tsx` — expect FAIL (only 0 or 1 Cancel buttons found).

- [ ] **Step 3: Implement** — in `OrdersPage.tsx` replace the condition:

```tsx
// before
{order.status?.toLowerCase() === 'pending' && (
// after
{['pending', 'open', 'partially_filled'].includes(order.status?.toLowerCase() ?? '') && (
```

- [ ] **Step 4: Run to verify it passes** — same command, expect PASS (whole file green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/trading/OrdersPage.tsx frontend/src/pages/trading/OrdersPage.test.tsx
git commit -m "fix: allow cancelling open and partially-filled orders from Orders page"
```

---

### Task 2: Candle history pagination (`before` cursor)

**Files:**
- Modify: `backend/src/services/marketData.js` (add `getHistoricalPage`)
- Modify: `backend/src/routes/market.js` (extend `/history/:symbol` with `before`, raise `bars` cap to 1000)
- Test: `backend/src/__tests__/phase10/marketHistoryPage.test.js`

**Interfaces:**
- Consumes: existing `fetchYahoo(symbol, interval, bars)` (module-private) and redis `cacheGet`/`cacheSet`.
- Produces: `getHistoricalPage(symbol, interval, bars, before) → { symbol, interval, current_price, previous_close, candles, has_more }` where `candles` are ascending-time, `before` is an exclusive upper bound in epoch **milliseconds** matching `candle.timestamp`, and `has_more` is true when older candles exist beyond the returned page. Route response: `{ symbol, interval, bars, has_more, data: { candles, current_price, previous_close } }`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase10/marketHistoryPage.test.js
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
jest.mock('../../config/redis', () => ({ cacheGet: mockCacheGet, cacheSet: mockCacheSet }));

const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ get: (...args) => mockAxiosGet(...args) }));

const { getHistoricalPage } = require('../../services/marketData');

function yahooPayload(n) {
  // n ascending 1-minute candles starting at t0
  const t0 = 1760000000; // seconds
  return {
    chart: {
      result: [{
        meta: { symbol: 'AAPL', currency: 'USD', exchangeName: 'NMS', instrumentType: 'EQUITY', regularMarketPrice: 100 + n, chartPreviousClose: 100 },
        timestamp: Array.from({ length: n }, (_, i) => t0 + i * 60),
        indicators: { quote: [{
          open: Array.from({ length: n }, (_, i) => 100 + i),
          high: Array.from({ length: n }, (_, i) => 101 + i),
          low: Array.from({ length: n }, (_, i) => 99 + i),
          close: Array.from({ length: n }, (_, i) => 100.5 + i),
          volume: Array.from({ length: n }, () => 1000),
        }] },
      }],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
  mockAxiosGet.mockResolvedValue({ data: yahooPayload(500) });
});

describe('getHistoricalPage', () => {
  test('no cursor returns the newest `bars` candles with has_more', async () => {
    const page = await getHistoricalPage('AAPL', '1m', 300);
    expect(page.candles).toHaveLength(300);
    expect(page.has_more).toBe(true);
    // ascending order, newest last
    expect(page.candles[299].timestamp).toBeGreaterThan(page.candles[0].timestamp);
  });

  test('before cursor returns strictly older candles', async () => {
    const first = await getHistoricalPage('AAPL', '1m', 300);
    const cursor = first.candles[0].timestamp;
    const older = await getHistoricalPage('AAPL', '1m', 300, cursor);
    expect(older.candles.length).toBe(200); // 500 total - 300 newer
    expect(older.candles.every((c) => c.timestamp < cursor)).toBe(true);
    expect(older.has_more).toBe(false);
  });

  test('full-range fetch is cached: two pages, one upstream call', async () => {
    mockCacheGet.mockResolvedValueOnce(null); // first call: miss
    const first = await getHistoricalPage('AAPL', '1m', 300);
    // second call: serve the full range from cache
    const [, fullRange] = mockCacheSet.mock.calls.find(([key]) => key.startsWith('histfull:'));
    mockCacheGet.mockResolvedValueOnce(fullRange);
    await getHistoricalPage('AAPL', '1m', 300, first.candles[0].timestamp);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && npx jest phase10/marketHistoryPage --coverage=false` — expect FAIL: `getHistoricalPage is not a function`.

- [ ] **Step 3: Implement** — in `backend/src/services/marketData.js`, add after `getHistoricalData` and export it:

```js
// Cursor-paged history for the analysis chart. Fetches the interval's FULL
// Yahoo range once, caches it whole, and slices pages out of the cache so
// panning back never re-hits the upstream API.
const FULL_RANGE_BARS = 5000;

async function getHistoricalPage(symbol, interval = '1h', bars = 300, before = null) {
  const cacheKey = `histfull:${symbol}:${interval}`;
  let full = await cacheGet(cacheKey);
  if (!full) {
    full = await fetchYahoo(symbol, interval, FULL_RANGE_BARS);
    const ttl = interval === '1m' ? 60 : interval === '5m' ? 300 : interval === '15m' ? 600 : interval === '1h' ? 900 : 3600;
    await cacheSet(cacheKey, full, ttl);
  }

  const all = full.candles;
  const upper = before ? all.filter((c) => c.timestamp < before) : all;
  const page = upper.slice(-bars);

  return {
    symbol: full.symbol,
    interval,
    current_price: full.current_price,
    previous_close: full.previous_close,
    candles: page,
    has_more: upper.length > page.length,
  };
}
```

Add `getHistoricalPage` to the `module.exports` line.

Then in `backend/src/routes/market.js`, extend the `/history/:symbol` route:

```js
// GET /api/market/history/:symbol?interval=1h&bars=300&before=<epoch_ms>
router.get('/history/:symbol', optionalAuth, [
  param('symbol').trim().notEmpty().isLength({ max: 20 }),
  query('interval').optional().isIn(VALID_INTERVALS),
  query('bars').optional().isInt({ min: 10, max: 1000 }),
  query('before').optional().isInt({ min: 0 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const symbol = req.params.symbol.toUpperCase();
  const interval = req.query.interval || '1h';
  const bars = Math.min(1000, parseInt(req.query.bars) || 200);
  const before = req.query.before ? parseInt(req.query.before) : null;

  const data = await getHistoricalPage(symbol, interval, bars, before);
  res.json({ symbol, interval, bars: data.candles.length, has_more: data.has_more, data });
}));
```

Update the route file's import to include `getHistoricalPage` from `../services/marketData`. Keep `getHistoricalData` exported and used elsewhere (the AI engine uses it) — do not remove it.

- [ ] **Step 4: Run new tests + existing market tests** — `npx jest phase10/marketHistoryPage market --coverage=false` — expect PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/marketData.js backend/src/routes/market.js backend/src/__tests__/phase10/marketHistoryPage.test.js
git commit -m "feat: cursor-paged candle history over cached full-range fetch"
```

---

### Task 3: Indicator parity fixtures

Generate fixture JSON from backend `indicators.js` (the math the AI sees) for the frontend library to assert against.

**Files:**
- Create: `backend/scripts/genIndicatorFixtures.js`
- Modify: `backend/package.json` (add script `gen:indicator-fixtures`)
- Create (generated, committed): `frontend/src/lib/indicators/__fixtures__/parity.json`

**Interfaces:**
- Produces: `parity.json` with shape `{ candles: Candle[], expected: { sma_20, sma_50, ema_12, ema_26, rsi_14, macd: {macd, signal, histogram}, bollinger_bands: {upper, middle, lower}, vwap, atr_14, stochastic: {k} } }` — `candles` are 250 deterministic synthetic bars; `expected` values come straight from `calculateAll` (already rounded to 4dp, bollinger to 2dp). Tasks 4–5 read this file.

- [ ] **Step 1: Write the generator**

```js
// backend/scripts/genIndicatorFixtures.js
// Regenerates the frontend indicator parity fixture from the backend math.
// Run: npm run gen:indicator-fixtures  (from backend/)
const fs = require('fs');
const path = require('path');
const { calculateAll } = require('../src/services/indicators');

// Deterministic pseudo-random walk (no Math.random) so the fixture is stable.
function makeCandles(n = 250) {
  const candles = [];
  let price = 100;
  let seed = 42;
  const rand = () => {
    // xorshift32
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1000) / 1000; // [0,1)
  };
  const t0 = 1760000000000;
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.48) * 2;
    const open = price;
    const close = +(price + drift).toFixed(4);
    const high = +(Math.max(open, close) + rand()).toFixed(4);
    const low = +(Math.min(open, close) - rand()).toFixed(4);
    const volume = 1000 + Math.floor(rand() * 9000);
    candles.push({ timestamp: t0 + i * 3600000, time: new Date(t0 + i * 3600000).toISOString(), open, high, low, close, volume });
    price = close;
  }
  return candles;
}

const candles = makeCandles();
const all = calculateAll(candles);
const fixture = {
  candles,
  expected: {
    sma_20: all.sma_20,
    sma_50: all.sma_50,
    ema_12: all.ema_12,
    ema_26: all.ema_26,
    rsi_14: all.rsi_14,
    macd: all.macd,
    bollinger_bands: { upper: all.bollinger_bands.upper, middle: all.bollinger_bands.middle, lower: all.bollinger_bands.lower },
    vwap: all.vwap,
    atr_14: all.atr_14,
    stochastic: { k: all.stochastic.k },
  },
};

const outPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'indicators', '__fixtures__', 'parity.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(fixture, null, 1));
console.log(`Wrote ${outPath} (${candles.length} candles)`);
```

Add to `backend/package.json` scripts: `"gen:indicator-fixtures": "node scripts/genIndicatorFixtures.js"`.

- [ ] **Step 2: Run it** — `cd backend && npm run gen:indicator-fixtures` — expect the "Wrote …parity.json (250 candles)" line; open the file and confirm `expected.sma_20` etc. are numbers, not null.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/genIndicatorFixtures.js backend/package.json frontend/src/lib/indicators/__fixtures__/parity.json
git commit -m "feat: indicator parity fixture generator (backend math -> frontend fixtures)"
```

---

### Task 4: Frontend indicator library — overlays

**Files:**
- Create: `frontend/src/lib/indicators/types.ts`
- Create: `frontend/src/lib/indicators/overlays.ts`
- Test: `frontend/src/lib/indicators/overlays.test.ts`

**Interfaces:**
- Produces (all series are ascending-time arrays the same length as input, `null` where the window is unfilled):
  - `type SeriesPoint = number | null`
  - `smaSeries(closes: number[], period: number): SeriesPoint[]`
  - `emaSeries(closes: number[], period: number): SeriesPoint[]`
  - `wmaSeries(closes: number[], period: number): SeriesPoint[]`
  - `bollingerSeries(closes: number[], period?: number, mult?: number): { upper: SeriesPoint[]; middle: SeriesPoint[]; lower: SeriesPoint[] }`
  - `vwapSeries(candles: Candle[]): SeriesPoint[]`
  - `keltnerSeries(candles: Candle[], emaPeriod?: number, atrPeriod?: number, mult?: number): { upper: SeriesPoint[]; middle: SeriesPoint[]; lower: SeriesPoint[] }`
  - `psarSeries(candles: Candle[], step?: number, max?: number): SeriesPoint[]`
  - `supertrendSeries(candles: Candle[], period?: number, mult?: number): SeriesPoint[]`
  - `Candle` is imported from `@/types/api`.
- Consumes: `atrSeries` from Task 5's `panes.ts` — **create `panes.ts` with `atrSeries` only in this task**; Task 5 fills in the rest.

- [ ] **Step 1: Write `types.ts`**

```ts
// frontend/src/lib/indicators/types.ts
export type SeriesPoint = number | null

export type OverlayKind = 'sma' | 'ema' | 'wma' | 'bollinger' | 'vwap' | 'keltner' | 'psar' | 'supertrend'
export type PaneKind = 'rsi' | 'macd' | 'stochastic' | 'atr' | 'obv'
export type IndicatorKind = OverlayKind | PaneKind

export interface IndicatorConfig {
  id: string // unique instance id, e.g. 'sma-20-a1b2'
  kind: IndicatorKind
  params: Record<string, number>
  visible: boolean
}

export const PANE_KINDS: PaneKind[] = ['rsi', 'macd', 'stochastic', 'atr', 'obv']

export function isPaneKind(kind: IndicatorKind): kind is PaneKind {
  return (PANE_KINDS as string[]).includes(kind)
}

// Default layout: what the AI itself watches.
export const DEFAULT_LAYOUT: IndicatorConfig[] = [
  { id: 'sma-20', kind: 'sma', params: { period: 20 }, visible: true },
  { id: 'sma-50', kind: 'sma', params: { period: 50 }, visible: true },
  { id: 'sma-200', kind: 'sma', params: { period: 200 }, visible: true },
  { id: 'bb-20', kind: 'bollinger', params: { period: 20, mult: 2 }, visible: true },
  { id: 'vwap', kind: 'vwap', params: {}, visible: true },
  { id: 'rsi-14', kind: 'rsi', params: { period: 14 }, visible: true },
  { id: 'macd-12-26-9', kind: 'macd', params: { fast: 12, slow: 26, signal: 9 }, visible: true },
]

export const DEFAULT_PARAMS: Record<IndicatorKind, Record<string, number>> = {
  sma: { period: 20 },
  ema: { period: 21 },
  wma: { period: 20 },
  bollinger: { period: 20, mult: 2 },
  vwap: {},
  keltner: { emaPeriod: 20, atrPeriod: 10, mult: 2 },
  psar: { step: 0.02, max: 0.2 },
  supertrend: { period: 10, mult: 3 },
  rsi: { period: 14 },
  macd: { fast: 12, slow: 26, signal: 9 },
  stochastic: { kPeriod: 14, dPeriod: 3 },
  atr: { period: 14 },
  obv: {},
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// frontend/src/lib/indicators/overlays.test.ts
import { describe, test, expect } from 'vitest'
import fixture from './__fixtures__/parity.json'
import { smaSeries, emaSeries, wmaSeries, bollingerSeries, vwapSeries, keltnerSeries, psarSeries, supertrendSeries } from './overlays'
import type { Candle } from '@/types/api'

const candles = fixture.candles as Candle[]
const closes = candles.map((c) => c.close)
const last = <T,>(arr: T[]) => arr[arr.length - 1]
const round4 = (v: number | null) => (v === null ? null : parseFloat(v.toFixed(4)))
const round2 = (v: number | null) => (v === null ? null : parseFloat(v.toFixed(2)))

describe('series shape', () => {
  test('output length equals input length with leading nulls', () => {
    const s = smaSeries(closes, 20)
    expect(s).toHaveLength(closes.length)
    expect(s.slice(0, 19).every((v) => v === null)).toBe(true)
    expect(s[19]).not.toBeNull()
  })

  test('window larger than data yields all nulls', () => {
    expect(smaSeries(closes.slice(0, 5), 20).every((v) => v === null)).toBe(true)
  })
})

describe('parity with backend indicators.js', () => {
  test('sma_20 / sma_50', () => {
    expect(round4(last(smaSeries(closes, 20)))).toBe(fixture.expected.sma_20)
    expect(round4(last(smaSeries(closes, 50)))).toBe(fixture.expected.sma_50)
  })
  test('ema_12 / ema_26', () => {
    expect(round4(last(emaSeries(closes, 12)))).toBe(fixture.expected.ema_12)
    expect(round4(last(emaSeries(closes, 26)))).toBe(fixture.expected.ema_26)
  })
  test('bollinger 20/2', () => {
    const bb = bollingerSeries(closes, 20, 2)
    expect(round2(last(bb.upper))).toBe(fixture.expected.bollinger_bands.upper)
    expect(round2(last(bb.middle))).toBe(fixture.expected.bollinger_bands.middle)
    expect(round2(last(bb.lower))).toBe(fixture.expected.bollinger_bands.lower)
  })
  test('vwap', () => {
    expect(round4(last(vwapSeries(candles)))).toBe(fixture.expected.vwap)
  })
})

describe('overlay-only indicators (sanity, no backend twin)', () => {
  test('wma reacts faster than sma', () => {
    const w = last(wmaSeries(closes, 20))!
    const s = last(smaSeries(closes, 20))!
    expect(typeof w).toBe('number')
    expect(w).not.toBe(s)
  })
  test('keltner produces ordered bands', () => {
    const k = keltnerSeries(candles)
    const i = candles.length - 1
    expect(k.upper[i]!).toBeGreaterThan(k.middle[i]!)
    expect(k.lower[i]!).toBeLessThan(k.middle[i]!)
  })
  test('psar stays within recent price range', () => {
    const p = last(psarSeries(candles))!
    const highs = Math.max(...candles.slice(-50).map((c) => c.high))
    const lows = Math.min(...candles.slice(-50).map((c) => c.low))
    expect(p).toBeGreaterThan(lows * 0.9)
    expect(p).toBeLessThan(highs * 1.1)
  })
  test('supertrend emits a numeric line once warmed up', () => {
    const st = supertrendSeries(candles)
    expect(st).toHaveLength(candles.length)
    expect(typeof last(st)).toBe('number')
  })
})
```

- [ ] **Step 3: Run to verify they fail** — `cd frontend && npx vitest run src/lib/indicators/overlays.test.ts` — expect FAIL: cannot resolve `./overlays`.

- [ ] **Step 4: Implement `panes.ts` (atrSeries only) and `overlays.ts`**

```ts
// frontend/src/lib/indicators/panes.ts  (Task 5 adds the remaining pane series)
import type { Candle } from '@/types/api'
import type { SeriesPoint } from './types'

// True range per candle (index 0 has no previous close -> null)
export function trueRanges(candles: Candle[]): SeriesPoint[] {
  return candles.map((c, i) => {
    if (i === 0) return null
    const prev = candles[i - 1]
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
  })
}

// Simple rolling mean of true ranges — matches backend atr()
export function atrSeries(candles: Candle[], period = 14): SeriesPoint[] {
  const trs = trueRanges(candles)
  return trs.map((_, i) => {
    if (i < period) return null
    const window = trs.slice(i - period + 1, i + 1)
    if (window.some((v) => v === null)) return null
    return (window as number[]).reduce((a, b) => a + b, 0) / period
  })
}
```

```ts
// frontend/src/lib/indicators/overlays.ts
// Price-overlay indicator series. Every function returns an array aligned
// 1:1 with its input (ascending time), null where the window is unfilled.
// Parity-tested against backend/src/services/indicators.js via parity.json.
import type { Candle } from '@/types/api'
import type { SeriesPoint } from './types'
import { atrSeries } from './panes'

export function smaSeries(closes: number[], period: number): SeriesPoint[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]
    return sum / period
  })
}

// Seeded with the SMA of the first `period` closes — matches backend emaArray()
export function emaSeries(closes: number[], period: number): SeriesPoint[] {
  if (closes.length < period) return closes.map(() => null)
  const k = 2 / (period + 1)
  const out: SeriesPoint[] = new Array(period - 1).fill(null)
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  out.push(val)
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k)
    out.push(val)
  }
  return out
}

export function wmaSeries(closes: number[], period: number): SeriesPoint[] {
  const denom = (period * (period + 1)) / 2
  return closes.map((_, i) => {
    if (i < period - 1) return null
    let sum = 0
    for (let j = 0; j < period; j++) sum += closes[i - period + 1 + j] * (j + 1)
    return sum / denom
  })
}

export function bollingerSeries(closes: number[], period = 20, mult = 2) {
  const middle = smaSeries(closes, period)
  const upper: SeriesPoint[] = []
  const lower: SeriesPoint[] = []
  closes.forEach((_, i) => {
    const mid = middle[i]
    if (mid === null) { upper.push(null); lower.push(null); return }
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mid) ** 2
    const sd = Math.sqrt(variance / period)
    upper.push(mid + mult * sd)
    lower.push(mid - mult * sd)
  })
  return { upper, middle, lower }
}

// Cumulative VWAP over the loaded window — matches backend vwap() at the tail
export function vwapSeries(candles: Candle[]): SeriesPoint[] {
  let cumPV = 0
  let cumV = 0
  return candles.map((c) => {
    if (!c.volume || !c.high || !c.low || !c.close) return cumV ? cumPV / cumV : null
    const tp = (c.high + c.low + c.close) / 3
    cumPV += tp * c.volume
    cumV += c.volume
    return cumPV / cumV
  })
}

export function keltnerSeries(candles: Candle[], emaPeriod = 20, atrPeriod = 10, mult = 2) {
  const middle = emaSeries(candles.map((c) => c.close), emaPeriod)
  const atr = atrSeries(candles, atrPeriod)
  const upper = middle.map((m, i) => (m !== null && atr[i] !== null ? m + mult * atr[i]! : null))
  const lower = middle.map((m, i) => (m !== null && atr[i] !== null ? m - mult * atr[i]! : null))
  return { upper, middle, lower }
}

export function psarSeries(candles: Candle[], step = 0.02, max = 0.2): SeriesPoint[] {
  if (candles.length < 2) return candles.map(() => null)
  const out: SeriesPoint[] = [null]
  let uptrend = candles[1].close >= candles[0].close
  let sar = uptrend ? candles[0].low : candles[0].high
  let ep = uptrend ? candles[0].high : candles[0].low
  let af = step
  for (let i = 1; i < candles.length; i++) {
    sar = sar + af * (ep - sar)
    const c = candles[i]
    if (uptrend) {
      sar = Math.min(sar, candles[i - 1].low, i >= 2 ? candles[i - 2].low : candles[i - 1].low)
      if (c.low < sar) { uptrend = false; sar = ep; ep = c.low; af = step }
      else if (c.high > ep) { ep = c.high; af = Math.min(af + step, max) }
    } else {
      sar = Math.max(sar, candles[i - 1].high, i >= 2 ? candles[i - 2].high : candles[i - 1].high)
      if (c.high > sar) { uptrend = true; sar = ep; ep = c.high; af = step }
      else if (c.low < ep) { ep = c.low; af = Math.min(af + step, max) }
    }
    out.push(sar)
  }
  return out
}

export function supertrendSeries(candles: Candle[], period = 10, mult = 3): SeriesPoint[] {
  const atr = atrSeries(candles, period)
  const out: SeriesPoint[] = []
  let upper: number | null = null
  let lower: number | null = null
  let trendUp = true
  candles.forEach((c, i) => {
    const a = atr[i]
    if (a === null) { out.push(null); return }
    const mid = (c.high + c.low) / 2
    const basicUpper = mid + mult * a
    const basicLower = mid - mult * a
    const prevClose = candles[i - 1]?.close ?? c.close
    upper = upper !== null && (basicUpper > upper && prevClose <= upper) ? upper : basicUpper
    lower = lower !== null && (basicLower < lower && prevClose >= lower) ? lower : basicLower
    if (c.close > (upper ?? Infinity)) trendUp = true
    else if (c.close < (lower ?? -Infinity)) trendUp = false
    out.push(trendUp ? lower : upper)
  })
  return out
}
```

- [ ] **Step 5: Run to verify they pass** — `npx vitest run src/lib/indicators/overlays.test.ts` — expect PASS (all parity + sanity tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/indicators/types.ts frontend/src/lib/indicators/overlays.ts frontend/src/lib/indicators/panes.ts frontend/src/lib/indicators/overlays.test.ts
git commit -m "feat: client-side overlay indicator library with backend parity tests"
```

---

### Task 5: Frontend indicator library — oscillator panes

**Files:**
- Modify: `frontend/src/lib/indicators/panes.ts` (add rsi/macd/stochastic/obv)
- Test: `frontend/src/lib/indicators/panes.test.ts`

**Interfaces:**
- Produces (appended to `panes.ts`, same aligned-array convention):
  - `rsiSeries(closes: number[], period?: number): SeriesPoint[]`
  - `macdSeries(closes: number[], fast?: number, slow?: number, signal?: number): { macd: SeriesPoint[]; signal: SeriesPoint[]; histogram: SeriesPoint[] }`
  - `stochasticSeries(candles: Candle[], kPeriod?: number, dPeriod?: number): { k: SeriesPoint[]; d: SeriesPoint[] }`
  - `obvSeries(candles: Candle[]): SeriesPoint[]`
  - (`atrSeries`, `trueRanges` already exist from Task 4)

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/indicators/panes.test.ts
import { describe, test, expect } from 'vitest'
import fixture from './__fixtures__/parity.json'
import { rsiSeries, macdSeries, stochasticSeries, atrSeries, obvSeries } from './panes'
import type { Candle } from '@/types/api'

const candles = fixture.candles as Candle[]
const closes = candles.map((c) => c.close)
const last = <T,>(arr: T[]) => arr[arr.length - 1]
const round4 = (v: number | null) => (v === null ? null : parseFloat(v.toFixed(4)))
const round2 = (v: number | null) => (v === null ? null : parseFloat(v.toFixed(2)))

describe('parity with backend indicators.js', () => {
  test('rsi_14', () => {
    expect(round4(last(rsiSeries(closes, 14)))).toBe(fixture.expected.rsi_14)
  })
  test('macd 12/26/9', () => {
    const m = macdSeries(closes, 12, 26, 9)
    expect(round4(last(m.macd))).toBe(fixture.expected.macd.macd)
    expect(round4(last(m.signal))).toBe(fixture.expected.macd.signal)
    expect(round4(last(m.histogram))).toBe(fixture.expected.macd.histogram)
  })
  test('atr_14', () => {
    expect(round4(last(atrSeries(candles, 14)))).toBe(fixture.expected.atr_14)
  })
  test('stochastic %K', () => {
    const s = stochasticSeries(candles, 14, 3)
    expect(round2(last(s.k))).toBe(fixture.expected.stochastic.k)
  })
})

describe('pane-only indicators', () => {
  test('rsi stays within 0-100', () => {
    const r = rsiSeries(closes, 14).filter((v): v is number => v !== null)
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...r)).toBeLessThanOrEqual(100)
  })
  test('%D is the smoothed %K', () => {
    const s = stochasticSeries(candles, 14, 3)
    const i = candles.length - 1
    const manual = (s.k[i]! + s.k[i - 1]! + s.k[i - 2]!) / 3
    expect(s.d[i]).toBeCloseTo(manual, 8)
  })
  test('obv is cumulative and length-aligned', () => {
    const o = obvSeries(candles)
    expect(o).toHaveLength(candles.length)
    expect(o[0]).toBe(0)
    expect(typeof last(o)).toBe('number')
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/indicators/panes.test.ts` — expect FAIL: `rsiSeries` not exported.

- [ ] **Step 3: Implement** — append to `frontend/src/lib/indicators/panes.ts`:

```ts
// Simple-average RSI over a fixed window — matches backend rsi()
export function rsiSeries(closes: number[], period = 14): SeriesPoint[] {
  return closes.map((_, i) => {
    if (i < period) return null
    let gains = 0
    let losses = 0
    for (let j = i - period + 1; j <= i; j++) {
      const change = closes[j] - closes[j - 1]
      if (change > 0) gains += change
      else losses -= change
    }
    const avgLoss = losses / period
    if (avgLoss === 0) return 100
    const rs = gains / period / avgLoss
    return 100 - 100 / (1 + rs)
  })
}

// EMA over an array that may contain leading nulls (used for the MACD signal line)
function emaOverValid(values: SeriesPoint[], period: number): SeriesPoint[] {
  const firstIdx = values.findIndex((v) => v !== null)
  if (firstIdx === -1) return values.map(() => null)
  const valid = values.slice(firstIdx) as number[]
  if (valid.length < period) return values.map(() => null)
  const k = 2 / (period + 1)
  const out: SeriesPoint[] = new Array(firstIdx + period - 1).fill(null)
  let val = valid.slice(0, period).reduce((a, b) => a + b, 0) / period
  out.push(val)
  for (let i = period; i < valid.length; i++) {
    val = valid[i] * k + val * (1 - k)
    out.push(val)
  }
  return out
}

export function macdSeries(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = emaOverValid(closes.map((c) => c), fast)
  const emaSlow = emaOverValid(closes.map((c) => c), slow)
  const macd = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i]! - emaSlow[i]! : null,
  )
  const signalLine = emaOverValid(macd, signal)
  const histogram = macd.map((m, i) =>
    m !== null && signalLine[i] !== null ? m - signalLine[i]! : null,
  )
  return { macd, signal: signalLine, histogram }
}

export function stochasticSeries(candles: Candle[], kPeriod = 14, dPeriod = 3) {
  const k: SeriesPoint[] = candles.map((c, i) => {
    if (i < kPeriod - 1) return null
    const slice = candles.slice(i - kPeriod + 1, i + 1)
    const highMax = Math.max(...slice.map((x) => x.high))
    const lowMin = Math.min(...slice.map((x) => x.low))
    if (highMax === lowMin) return 50
    return ((c.close - lowMin) / (highMax - lowMin)) * 100
  })
  const d: SeriesPoint[] = k.map((_, i) => {
    if (i < kPeriod - 1 + dPeriod - 1) return null
    const window = k.slice(i - dPeriod + 1, i + 1)
    if (window.some((v) => v === null)) return null
    return (window as number[]).reduce((a, b) => a + b, 0) / dPeriod
  })
  return { k, d }
}

export function obvSeries(candles: Candle[]): SeriesPoint[] {
  let obv = 0
  return candles.map((c, i) => {
    if (i === 0) return 0
    const prev = candles[i - 1]
    if (c.close > prev.close) obv += c.volume ?? 0
    else if (c.close < prev.close) obv -= c.volume ?? 0
    return obv
  })
}
```

Note on the backend `emaArray` quirk: the backend's MACD signal is `ema()` over the *compacted* valid MACD values — `emaOverValid` reproduces exactly that (skip leading nulls, seed with SMA of the first `signal` valid values). If the parity test for `macd.signal` fails by a small margin, diff your compaction against `backend/src/services/indicators.js:47-61` before touching tolerances — the values must match to 4dp exactly.

- [ ] **Step 4: Run to verify they pass** — `npx vitest run src/lib/indicators` — expect PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/indicators/panes.ts frontend/src/lib/indicators/panes.test.ts
git commit -m "feat: oscillator pane indicator series with backend parity"
```

---

### Task 6: Candle data hooks (`useCandles`, `useLiveCandle`, prefetch)

**Files:**
- Create: `frontend/src/hooks/useCandles.ts`
- Test: `frontend/src/hooks/useCandles.test.tsx`

**Interfaces:**
- Consumes: Task 2's route (`GET /market/history/:symbol?interval&bars&before` → `{ has_more, data: { candles, current_price, previous_close } }`), existing `useLivePrices` from `@/hooks/useWebSocket` (returns `Record<symbol, { price?: number }>`), `api` from `@/lib/api`.
- Produces:
  - `useCandles(symbol: string, timeframe: string): { candles: Candle[]; currentPrice: number | null; isLoading: boolean; hasMore: boolean; loadOlder: () => void; isLoadingOlder: boolean }` — `candles` ascending, older pages prepended.
  - `prefetchCandles(queryClient: QueryClient, symbol: string, timeframe?: string): void`
  - `mergeLivePrice(candles: Candle[], price: number | null | undefined): Candle[]` — pure helper: returns candles with the last one updated (`close = price`, high/low widened); exported for tests and used by the page.
  - `candlesKey(symbol: string, timeframe: string)` → query key.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/hooks/useCandles.test.tsx
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { api } from '@/lib/api'
import { useCandles, mergeLivePrice } from './useCandles'
import type { Candle } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
  API_BASE_URL: 'http://localhost:3001',
}))

function candle(i: number): Candle & { timestamp: number } {
  return { timestamp: i * 60000, time: new Date(i * 60000).toISOString(), open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => vi.clearAllMocks())

describe('useCandles', () => {
  test('fetches the first page and exposes candles + price', async () => {
    ;(api.get as Mock).mockResolvedValue({
      data: { has_more: true, data: { candles: [candle(1), candle(2)], current_price: 100.7, previous_close: 99 } },
    })
    const { result } = renderHook(() => useCandles('AAPL', '1h'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.candles).toHaveLength(2)
    expect(result.current.currentPrice).toBe(100.7)
    expect(result.current.hasMore).toBe(true)
    expect(api.get).toHaveBeenCalledWith('/market/history/AAPL', { params: { interval: '1h', bars: 300 } })
  })

  test('loadOlder prepends the previous page using the oldest timestamp as cursor', async () => {
    ;(api.get as Mock)
      .mockResolvedValueOnce({ data: { has_more: true, data: { candles: [candle(10), candle(11)], current_price: 1, previous_close: 1 } } })
      .mockResolvedValueOnce({ data: { has_more: false, data: { candles: [candle(8), candle(9)], current_price: 1, previous_close: 1 } } })
    const { result } = renderHook(() => useCandles('AAPL', '1h'), { wrapper })
    await waitFor(() => expect(result.current.candles).toHaveLength(2))
    act(() => result.current.loadOlder())
    await waitFor(() => expect(result.current.candles).toHaveLength(4))
    expect(result.current.candles[0].time).toBe(candle(8).time)
    expect(result.current.hasMore).toBe(false)
    expect((api.get as Mock).mock.calls[1][1].params.before).toBe(10 * 60000)
  })
})

describe('mergeLivePrice', () => {
  test('updates close and widens high/low of the last candle', () => {
    const merged = mergeLivePrice([candle(1), candle(2)], 103)
    expect(merged[1].close).toBe(103)
    expect(merged[1].high).toBe(103)
    expect(merged[0]).toEqual(candle(1))
  })
  test('no price -> unchanged reference', () => {
    const arr = [candle(1)]
    expect(mergeLivePrice(arr, null)).toBe(arr)
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/hooks/useCandles.test.tsx` — expect FAIL: cannot resolve `./useCandles`.

- [ ] **Step 3: Implement**

```ts
// frontend/src/hooks/useCandles.ts
import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Candle } from '@/types/api'

interface HistoryPage {
  has_more: boolean
  data: { candles: (Candle & { timestamp?: number })[]; current_price: number | null; previous_close: number | null }
}

const PAGE_BARS = 300

export const candlesKey = (symbol: string, timeframe: string) => ['candles', symbol, timeframe] as const

async function fetchPage(symbol: string, timeframe: string, before?: number): Promise<HistoryPage> {
  const params: Record<string, string | number> = { interval: timeframe, bars: PAGE_BARS }
  if (before) params.before = before
  const res = await api.get<HistoryPage>(`/market/history/${symbol}`, { params })
  return res.data
}

export function useCandles(symbol: string, timeframe: string) {
  const query = useInfiniteQuery({
    queryKey: candlesKey(symbol, timeframe),
    queryFn: ({ pageParam }) => fetchPage(symbol, timeframe, pageParam as number | undefined),
    initialPageParam: undefined as number | undefined,
    // pages are stored newest-first; the cursor is the oldest loaded timestamp
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined
      const oldest = lastPage.data.candles[0] as Candle & { timestamp?: number }
      return oldest?.timestamp ?? undefined
    },
    staleTime: 60_000,
  })

  const pages = query.data?.pages ?? []
  // pages[0] is the newest; older pages come after — prepend in reverse
  const candles = pages.slice().reverse().flatMap((p) => p.data.candles)
  const newest = pages[0]

  return {
    candles,
    currentPrice: newest?.data.current_price ?? null,
    isLoading: query.isLoading,
    hasMore: query.hasNextPage ?? false,
    loadOlder: () => { if (!query.isFetchingNextPage) void query.fetchNextPage() },
    isLoadingOlder: query.isFetchingNextPage,
  }
}

export function prefetchCandles(queryClient: QueryClient, symbol: string, timeframe = '1h') {
  void queryClient.prefetchInfiniteQuery({
    queryKey: candlesKey(symbol, timeframe),
    queryFn: () => fetchPage(symbol, timeframe),
    initialPageParam: undefined as number | undefined,
    staleTime: 60_000,
  })
}

// Merge a live tick into the forming (last) candle. Pure; returns the same
// reference when there is nothing to merge so React effects don't loop.
export function mergeLivePrice(candles: Candle[], price: number | null | undefined): Candle[] {
  if (!price || candles.length === 0) return candles
  const last = candles[candles.length - 1]
  if (last.close === price) return candles
  const updated: Candle = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  }
  return [...candles.slice(0, -1), updated]
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run src/hooks/useCandles.test.tsx` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useCandles.ts frontend/src/hooks/useCandles.test.tsx
git commit -m "feat: paged candle hook with live-tick merge and prefetch"
```

---

### Task 7: AnalysisChart component

**Files:**
- Create: `frontend/src/components/analysis/AnalysisChart.tsx`
- Test: `frontend/src/components/analysis/AnalysisChart.test.tsx`

**Interfaces:**
- Consumes: indicator library (Tasks 4–5), `IndicatorConfig`/`isPaneKind` from `types.ts`, lightweight-charts v5.
- Produces:
  ```ts
  interface AnalysisChartProps {
    candles: Candle[]
    indicators: IndicatorConfig[]
    signal?: Signal | null
    showSignal?: boolean          // default true
    logScale?: boolean            // default false
    onReachOldest?: () => void    // fired when user pans near the left edge
  }
  export function AnalysisChart(props: AnalysisChartProps): JSX.Element
  ```
  Renders one `<div data-testid="analysis-chart">` container. Task 10's page owns timeframe tabs, fullscreen, and toggles — this component is chart-only.

- [ ] **Step 1: Check the v5 pane API surface** — run:

```bash
grep -n "addSeries\|addPane\|paneIndex" frontend/node_modules/lightweight-charts/dist/typings.d.ts | head -20
```

Confirm `addSeries` accepts `(definition, options?, paneIndex?)`. If the signature differs, adapt the calls below to what the typings show — the typings file is authoritative.

- [ ] **Step 2: Write the failing tests** — lightweight-charts needs canvas, so mock the module and assert orchestration:

```tsx
// frontend/src/components/analysis/AnalysisChart.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { AnalysisChart } from './AnalysisChart'
import type { Candle, Signal } from '@/types/api'

const setData = vi.fn()
const update = vi.fn()
const createPriceLine = vi.fn()
const removeSeries = vi.fn()
const addSeries = vi.fn(() => ({ setData, update, createPriceLine, applyOptions: vi.fn() }))
const chartApi = {
  addSeries,
  removeSeries,
  remove: vi.fn(),
  applyOptions: vi.fn(),
  priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
  timeScale: vi.fn(() => ({ fitContent: vi.fn(), subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() })),
  subscribeCrosshairMove: vi.fn(),
}

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => chartApi),
  CandlestickSeries: 'CandlestickSeries',
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  ColorType: { Solid: 'solid' },
  LineStyle: { Dashed: 2, Solid: 0 },
}))

function candle(i: number): Candle {
  return { time: new Date(1760000000000 + i * 3600000).toISOString(), open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000 }
}
const candles = Array.from({ length: 60 }, (_, i) => candle(i))

const signal: Signal = {
  id: 'sig-1', symbol: 'AAPL', signal_type: 'buy', confidence: 82,
  entry_price: 150, stop_loss: 145, take_profit: 160,
}

beforeEach(() => vi.clearAllMocks())

describe('AnalysisChart', () => {
  test('creates candlestick + volume series and feeds candle data', () => {
    render(<AnalysisChart candles={candles} indicators={[]} />)
    expect(screen.getByTestId('analysis-chart')).toBeInTheDocument()
    const kinds = addSeries.mock.calls.map((c) => c[0])
    expect(kinds).toContain('CandlestickSeries')
    expect(kinds).toContain('HistogramSeries') // volume
    expect(setData).toHaveBeenCalled()
  })

  test('adds a line series per visible overlay instance and skips hidden ones', () => {
    render(
      <AnalysisChart
        candles={candles}
        indicators={[
          { id: 'sma-20', kind: 'sma', params: { period: 20 }, visible: true },
          { id: 'sma-50', kind: 'sma', params: { period: 50 }, visible: false },
        ]}
      />,
    )
    const lineCalls = addSeries.mock.calls.filter((c) => c[0] === 'LineSeries')
    expect(lineCalls).toHaveLength(1)
  })

  test('pane indicators get a pane index > 0', () => {
    render(
      <AnalysisChart
        candles={candles}
        indicators={[{ id: 'rsi-14', kind: 'rsi', params: { period: 14 }, visible: true }]}
      />,
    )
    const rsiCall = addSeries.mock.calls.find((c) => c[0] === 'LineSeries' && (c[2] ?? 0) > 0)
    expect(rsiCall).toBeTruthy()
  })

  test('draws entry/stop/take-profit price lines for the signal', () => {
    render(<AnalysisChart candles={candles} indicators={[]} signal={signal} />)
    expect(createPriceLine).toHaveBeenCalledTimes(3)
    const prices = createPriceLine.mock.calls.map((c) => c[0].price)
    expect(prices).toEqual(expect.arrayContaining([150, 145, 160]))
  })

  test('showSignal=false draws no price lines', () => {
    render(<AnalysisChart candles={candles} indicators={[]} signal={signal} showSignal={false} />)
    expect(createPriceLine).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify they fail** — `npx vitest run src/components/analysis/AnalysisChart.test.tsx` — expect FAIL: cannot resolve `./AnalysisChart`.

- [ ] **Step 4: Implement**

```tsx
// frontend/src/components/analysis/AnalysisChart.tsx
// Chart-only renderer: candles + volume, overlay/pane indicators from config,
// AI signal price lines. Page-level chrome (tabs, toggles) lives in the page.
import { useEffect, useRef } from 'react'
import {
  CandlestickSeries, HistogramSeries, LineSeries, ColorType, LineStyle,
  createChart, type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle, Signal } from '@/types/api'
import { type IndicatorConfig, isPaneKind } from '@/lib/indicators/types'
import { smaSeries, emaSeries, wmaSeries, bollingerSeries, vwapSeries, keltnerSeries, psarSeries, supertrendSeries } from '@/lib/indicators/overlays'
import { rsiSeries, macdSeries, stochasticSeries, atrSeries, obvSeries } from '@/lib/indicators/panes'
import type { SeriesPoint } from '@/lib/indicators/types'

export interface AnalysisChartProps {
  candles: Candle[]
  indicators: IndicatorConfig[]
  signal?: Signal | null
  showSignal?: boolean
  logScale?: boolean
  onReachOldest?: () => void
}

const OVERLAY_COLORS = ['#3b82f6', '#f59e0b', '#a855f7', '#14b8a6', '#f43f5e', '#84cc16']

const toTs = (c: Candle) => (new Date(c.time).getTime() / 1000) as UTCTimestamp

function toLine(candles: Candle[], values: SeriesPoint[]) {
  const out: { time: UTCTimestamp; value: number }[] = []
  values.forEach((v, i) => { if (v !== null) out.push({ time: toTs(candles[i]), value: v }) })
  return out
}

// Every named line an indicator instance produces: [label, values][]
function indicatorLines(cfg: IndicatorConfig, candles: Candle[]): [string, SeriesPoint[]][] {
  const closes = candles.map((c) => c.close)
  const p = cfg.params
  switch (cfg.kind) {
    case 'sma': return [[`SMA ${p.period}`, smaSeries(closes, p.period)]]
    case 'ema': return [[`EMA ${p.period}`, emaSeries(closes, p.period)]]
    case 'wma': return [[`WMA ${p.period}`, wmaSeries(closes, p.period)]]
    case 'bollinger': {
      const b = bollingerSeries(closes, p.period, p.mult)
      return [[`BB upper`, b.upper], [`BB mid`, b.middle], [`BB lower`, b.lower]]
    }
    case 'vwap': return [['VWAP', vwapSeries(candles)]]
    case 'keltner': {
      const k = keltnerSeries(candles, p.emaPeriod, p.atrPeriod, p.mult)
      return [['KC upper', k.upper], ['KC mid', k.middle], ['KC lower', k.lower]]
    }
    case 'psar': return [['PSAR', psarSeries(candles, p.step, p.max)]]
    case 'supertrend': return [['SuperTrend', supertrendSeries(candles, p.period, p.mult)]]
    case 'rsi': return [[`RSI ${p.period}`, rsiSeries(closes, p.period)]]
    case 'macd': {
      const m = macdSeries(closes, p.fast, p.slow, p.signal)
      return [['MACD', m.macd], ['Signal', m.signal], ['Hist', m.histogram]]
    }
    case 'stochastic': {
      const s = stochasticSeries(candles, p.kPeriod, p.dPeriod)
      return [['%K', s.k], ['%D', s.d]]
    }
    case 'atr': return [[`ATR ${p.period}`, atrSeries(candles, p.period)]]
    case 'obv': return [['OBV', obvSeries(candles)]]
  }
}

export function AnalysisChart({ candles, indicators, signal, showSignal = true, logScale = false, onReachOldest }: AnalysisChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || candles.length === 0) return

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#262932' }, horzLines: { color: '#262932' } },
      width: el.clientWidth,
      height: el.clientHeight || 480,
      rightPriceScale: { mode: logScale ? 1 : 0 },
      timeScale: { timeVisible: true },
    })
    chartRef.current = chart

    // Price + volume (pane 0)
    const price = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })
    priceSeriesRef.current = price
    price.setData(candles.map((c) => ({ time: toTs(c), open: c.open, high: c.high, low: c.low, close: c.close })))

    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', color: '#3f3f46' })
    volume.setData(candles.map((c) => ({ time: toTs(c), value: c.volume ?? 0, color: c.close >= c.open ? '#16653466' : '#7f1d1d66' })))
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    // Indicators: overlays on pane 0, each pane-kind gets its own pane index
    let nextPane = 1
    let colorIdx = 0
    for (const cfg of indicators) {
      if (!cfg.visible) continue
      const pane = isPaneKind(cfg.kind) ? nextPane++ : 0
      for (const [label, values] of indicatorLines(cfg, candles)) {
        const s = chart.addSeries(LineSeries, {
          color: OVERLAY_COLORS[colorIdx++ % OVERLAY_COLORS.length],
          lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: label,
        }, pane)
        s.setData(toLine(candles, values))
      }
    }

    // AI signal price lines
    if (signal && showSignal) {
      const lines: { price?: number; color: string; style: number; title: string }[] = [
        { price: signal.entry_price, color: '#3b82f6', style: LineStyle.Solid, title: 'AI entry' },
        { price: signal.stop_loss, color: '#ef4444', style: LineStyle.Dashed, title: 'AI stop' },
        { price: signal.take_profit, color: '#22c55e', style: LineStyle.Dashed, title: 'AI target' },
      ]
      for (const l of lines) {
        if (l.price == null) continue
        price.createPriceLine({ price: l.price, color: l.color, lineStyle: l.style, lineWidth: 1, axisLabelVisible: true, title: l.title })
      }
    }

    // Pan-back: near the left edge, ask for older candles
    const ts = chart.timeScale()
    const onRange = (range: { from: number; to: number } | null) => {
      if (range && range.from < 10) onReachOldest?.()
    }
    ts.subscribeVisibleLogicalRangeChange(onRange)

    const onResize = () => chart.applyOptions({ width: el.clientWidth })
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      ts.unsubscribeVisibleLogicalRangeChange(onRange)
      chart.remove()
      chartRef.current = null
    }
    // Recreate on structural changes; live close updates arrive via the
    // candles array identity change and are cheap at this candle count.
  }, [candles, indicators, signal, showSignal, logScale, onReachOldest])

  return <div ref={containerRef} data-testid="analysis-chart" className="h-full min-h-[480px] w-full" />
}
```

Note: full chart re-creation on candle updates is acceptable at ≤1000 candles (lightweight-charts constructs in ~ms). If live updates visibly flicker during manual verification, optimize then by keeping series refs and calling `series.update()` for the last bar — do not pre-optimize.

- [ ] **Step 5: Run to verify they pass** — `npx vitest run src/components/analysis/AnalysisChart.test.tsx` — expect PASS. Also run `npx tsc --noEmit` — if series-type generics complain, match the typings file, not the plan.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/analysis/AnalysisChart.tsx frontend/src/components/analysis/AnalysisChart.test.tsx
git commit -m "feat: multi-pane analysis chart with indicator overlays and AI signal lines"
```

---

### Task 8: IndicatorManager + saved layouts

**Files:**
- Create: `frontend/src/components/analysis/IndicatorManager.tsx`
- Create: `frontend/src/hooks/useChartLayout.ts`
- Test: `frontend/src/components/analysis/IndicatorManager.test.tsx`

**Interfaces:**
- Consumes: `IndicatorConfig`, `DEFAULT_LAYOUT`, `DEFAULT_PARAMS`, `IndicatorKind` from `@/lib/indicators/types`; `GET /users/me` → `{ user: { preferences } }` and `PUT /users/me` with `{ preferences }` (whole preferences object — read-modify-write).
- Produces:
  - `IndicatorManager({ value, onChange }: { value: IndicatorConfig[]; onChange: (v: IndicatorConfig[]) => void })` — chip row: click chip toggles `visible`, × removes, "+ Indicator" opens a small popover listing all kinds with numeric param inputs (defaults from `DEFAULT_PARAMS`) and an Add button.
  - `useChartLayout(): { layout: IndicatorConfig[]; setLayout: (v: IndicatorConfig[]) => void; isLoaded: boolean }` — loads `preferences.chart_layout` (falls back to `DEFAULT_LAYOUT`), debounce-saves (800ms) on change via `PUT /users/me` merging into existing preferences.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/components/analysis/IndicatorManager.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { IndicatorManager } from './IndicatorManager'
import type { IndicatorConfig } from '@/lib/indicators/types'

const layout: IndicatorConfig[] = [
  { id: 'sma-20', kind: 'sma', params: { period: 20 }, visible: true },
  { id: 'rsi-14', kind: 'rsi', params: { period: 14 }, visible: false },
]

describe('IndicatorManager', () => {
  test('renders a chip per instance with visibility state', () => {
    render(<IndicatorManager value={layout} onChange={vi.fn()} />)
    expect(screen.getByText(/sma 20/i)).toBeInTheDocument()
    expect(screen.getByText(/rsi 14/i)).toBeInTheDocument()
  })

  test('clicking a chip toggles visibility', () => {
    const onChange = vi.fn()
    render(<IndicatorManager value={layout} onChange={onChange} />)
    fireEvent.click(screen.getByText(/sma 20/i))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'sma-20', visible: false }),
      expect.objectContaining({ id: 'rsi-14' }),
    ])
  })

  test('remove button deletes the instance', () => {
    const onChange = vi.fn()
    render(<IndicatorManager value={layout} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0])
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'rsi-14' })])
  })

  test('add flow appends a new instance with chosen params', () => {
    const onChange = vi.fn()
    render(<IndicatorManager value={layout} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add indicator/i }))
    fireEvent.click(screen.getByRole('button', { name: /^ema$/i }))
    fireEvent.change(screen.getByLabelText(/period/i), { target: { value: '34' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    const next = onChange.mock.calls[0][0] as IndicatorConfig[]
    expect(next).toHaveLength(3)
    expect(next[2]).toMatchObject({ kind: 'ema', params: { period: 34 }, visible: true })
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/components/analysis/IndicatorManager.test.tsx` — expect FAIL (module missing).

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/analysis/IndicatorManager.tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type IndicatorConfig, type IndicatorKind, DEFAULT_PARAMS } from '@/lib/indicators/types'

const ALL_KINDS: IndicatorKind[] = ['sma', 'ema', 'wma', 'bollinger', 'vwap', 'keltner', 'psar', 'supertrend', 'rsi', 'macd', 'stochastic', 'atr', 'obv']

function chipLabel(cfg: IndicatorConfig) {
  const params = Object.values(cfg.params).join('/')
  return params ? `${cfg.kind.toUpperCase()} ${params}` : cfg.kind.toUpperCase()
}

export function IndicatorManager({ value, onChange }: { value: IndicatorConfig[]; onChange: (v: IndicatorConfig[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<IndicatorKind | null>(null)
  const [params, setParams] = useState<Record<string, number>>({})

  const toggle = (id: string) =>
    onChange(value.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)))
  const remove = (id: string) => onChange(value.filter((c) => c.id !== id))

  const startAdd = (k: IndicatorKind) => {
    setKind(k)
    setParams({ ...DEFAULT_PARAMS[k] })
  }
  const confirmAdd = () => {
    if (!kind) return
    const id = `${kind}-${Date.now().toString(36)}`
    onChange([...value, { id, kind, params, visible: true }])
    setAdding(false)
    setKind(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((cfg) => (
        <span
          key={cfg.id}
          className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
            cfg.visible ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card text-muted'
          }`}
        >
          <button type="button" onClick={() => toggle(cfg.id)}>{chipLabel(cfg)}</button>
          <button type="button" aria-label={`remove ${chipLabel(cfg)}`} onClick={() => remove(cfg.id)} className="hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {!adding && (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
          + Add indicator
        </Button>
      )}

      {adding && !kind && (
        <span className="flex flex-wrap gap-1">
          {ALL_KINDS.map((k) => (
            <Button key={k} type="button" size="sm" variant="outline" onClick={() => startAdd(k)}>
              {k}
            </Button>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>cancel</Button>
        </span>
      )}

      {adding && kind && (
        <span className="flex items-center gap-1">
          {Object.entries(params).map(([name, val]) => (
            <label key={name} className="flex items-center gap-1 text-xs text-muted">
              {name}
              <Input
                aria-label={name}
                type="number"
                step="any"
                value={val}
                onChange={(e) => setParams((p) => ({ ...p, [name]: Number(e.target.value) }))}
                className="h-7 w-16"
              />
            </label>
          ))}
          <Button type="button" size="sm" onClick={confirmAdd}>Add</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setAdding(false); setKind(null) }}>cancel</Button>
        </span>
      )}
    </div>
  )
}
```

And the layout persistence hook:

```ts
// frontend/src/hooks/useChartLayout.ts
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_LAYOUT, type IndicatorConfig } from '@/lib/indicators/types'

interface MeResponse { user: { preferences?: { chart_layout?: IndicatorConfig[]; [k: string]: unknown } } }

export function useChartLayout() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<MeResponse>('/users/me')).data,
    staleTime: 5 * 60_000,
  })

  const [layout, setLayoutState] = useState<IndicatorConfig[]>(DEFAULT_LAYOUT)
  const loadedRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (loadedRef.current || !me.data) return
    loadedRef.current = true
    const saved = me.data.user.preferences?.chart_layout
    if (Array.isArray(saved) && saved.length) setLayoutState(saved)
  }, [me.data])

  const setLayout = (next: IndicatorConfig[]) => {
    setLayoutState(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const prefs = { ...(me.data?.user.preferences ?? {}), chart_layout: next }
      void api.put('/users/me', { preferences: prefs })
    }, 800)
  }

  return { layout, setLayout, isLoaded: !me.isLoading }
}
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run src/components/analysis/IndicatorManager.test.tsx` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/analysis/IndicatorManager.tsx frontend/src/hooks/useChartLayout.ts frontend/src/components/analysis/IndicatorManager.test.tsx
git commit -m "feat: indicator manager chips with per-user saved chart layouts"
```

---

### Task 9: Position sizing helper + TradeTicket

**Files:**
- Create: `frontend/src/lib/positionSize.ts`
- Create: `frontend/src/components/analysis/TradeTicket.tsx`
- Test: `frontend/src/lib/positionSize.test.ts`
- Test: `frontend/src/components/analysis/TradeTicket.test.tsx`

**Interfaces:**
- Consumes: `GET /brokers/connections` → `{ connections: [{ id, name, broker_id, status }] }`; `GET /brokers/connections/:id/accounts` → `{ account: { funds?: { equity?: number } } }`; `GET /auto-trading/settings` → `{ settings: { risk_per_trade_pct } }`; `POST /trading/orders` (snake_case body); `PUT /users/me` preferences for `trading: { instant_orders }`; `Signal` type.
- Produces:
  - `sizeByRisk({ equity, riskPct, entry, stop }): number` — mirrors backend `calculatePositionSize`: `floor(min(equity*riskPct/|entry-stop|, equity/entry))`, 0 on bad inputs.
  - `TradeTicket({ symbol, signal, currentPrice, armed }: { symbol: string; signal?: Signal | null; currentPrice?: number | null; armed?: boolean })` — self-contained (fetches its own connections/equity/settings). Task 11 also imports `placeInstantOrder` — export it:
  - `placeInstantOrder({ symbol, signal, connectionId, equity, riskPct }): Promise<{ orderId: string }>` — pure function that computes sizing and POSTs; throws on failure.

- [ ] **Step 1: Write the failing sizing tests**

```ts
// frontend/src/lib/positionSize.test.ts
import { describe, test, expect } from 'vitest'
import { sizeByRisk } from './positionSize'

describe('sizeByRisk', () => {
  test('risk-based quantity, capped by affordability', () => {
    // 100000 * 1% = 1000 risk; per-unit 5 -> 200; affordable floor(100000/150)=666 -> 200
    expect(sizeByRisk({ equity: 100000, riskPct: 0.01, entry: 150, stop: 145 })).toBe(200)
  })
  test('affordability cap wins when risk allows more', () => {
    // risk qty 10000, affordable 66
    expect(sizeByRisk({ equity: 10000, riskPct: 1, entry: 150, stop: 149 })).toBe(66)
  })
  test('zero on degenerate inputs', () => {
    expect(sizeByRisk({ equity: 0, riskPct: 0.01, entry: 150, stop: 145 })).toBe(0)
    expect(sizeByRisk({ equity: 100000, riskPct: 0.01, entry: 150, stop: 150 })).toBe(0)
    expect(sizeByRisk({ equity: 100000, riskPct: 0.01, entry: 0, stop: -5 })).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/positionSize.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `positionSize.ts`**

```ts
// frontend/src/lib/positionSize.ts
// Mirrors backend riskManagement.calculatePositionSize so the ticket's
// pre-filled quantity matches what the engine would size.
export function sizeByRisk({ equity, riskPct, entry, stop }: { equity: number; riskPct: number; entry: number; stop: number }): number {
  if (!equity || equity <= 0 || !entry || entry <= 0) return 0
  const perUnit = Math.abs(entry - stop)
  if (!perUnit) return 0
  const riskQty = Math.floor((equity * riskPct) / perUnit)
  const affordableQty = Math.floor(equity / entry)
  return Math.max(0, Math.min(riskQty, affordableQty))
}
```

Run the test again — PASS.

- [ ] **Step 4: Write the failing TradeTicket tests**

```tsx
// frontend/src/components/analysis/TradeTicket.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { TradeTicket } from './TradeTicket'
import { api } from '@/lib/api'
import type { Signal } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  getApiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error'),
}))
const toastFn = vi.fn()
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: toastFn }) }))

const signal: Signal = {
  id: 'sig-1', symbol: 'AAPL', signal_type: 'buy', confidence: 82,
  entry_price: 150, stop_loss: 145, take_profit: 160,
}

function mockGets() {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections: [{ id: 'conn-1', name: 'Alpaca Paper', broker_id: 'alpaca', status: 'connected' }] } })
    if (url === '/brokers/connections/conn-1/accounts') return Promise.resolve({ data: { account: { funds: { equity: 100000 } } } })
    if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings: { risk_per_trade_pct: 0.01 } } })
    if (url === '/users/me') return Promise.resolve({ data: { user: { preferences: {} } } })
    return Promise.resolve({ data: {} })
  })
}

function renderTicket(props: Partial<Parameters<typeof TradeTicket>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TradeTicket symbol="AAPL" signal={signal} currentPrice={150} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGets()
  ;(api.post as Mock).mockResolvedValue({ data: { order: { id: 'order-1' } } })
})

describe('TradeTicket', () => {
  test('pre-fills side, stops, and risk-sized quantity from the signal', async () => {
    renderTicket()
    await waitFor(() => expect(screen.getByLabelText(/quantity/i)).toHaveValue(200))
    expect(screen.getByLabelText(/stop loss/i)).toHaveValue(145)
    expect(screen.getByLabelText(/take profit/i)).toHaveValue(160)
    expect(screen.getByRole('button', { name: /^buy$/i })).toHaveAttribute('data-active', 'true')
  })

  test('confirm posts a snake_case bracket order with signal linkage', async () => {
    renderTicket()
    await waitFor(() => expect(screen.getByLabelText(/quantity/i)).toHaveValue(200))
    fireEvent.click(screen.getByRole('button', { name: /confirm buy/i }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/trading/orders', {
        broker_connection_id: 'conn-1',
        symbol: 'AAPL',
        side: 'buy',
        order_type: 'market',
        quantity: 200,
        stop_loss: 145,
        take_profit: 160,
        signal_id: 'sig-1',
      }),
    )
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Order placed', 'success'))
  })

  test('broker rejection keeps the ticket values and shows the message', async () => {
    ;(api.post as Mock).mockRejectedValue(new Error('insufficient buying power'))
    renderTicket()
    await waitFor(() => expect(screen.getByLabelText(/quantity/i)).toHaveValue(200))
    fireEvent.click(screen.getByRole('button', { name: /confirm buy/i }))
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('insufficient buying power', 'error'))
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(200)
  })

  test('equity failure leaves quantity blank with a hint', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/brokers/connections') return Promise.resolve({ data: { connections: [{ id: 'conn-1', name: 'Alpaca Paper', broker_id: 'alpaca', status: 'connected' }] } })
      if (url === '/brokers/connections/conn-1/accounts') return Promise.reject(new Error('broker down'))
      if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings: { risk_per_trade_pct: 0.01 } } })
      if (url === '/users/me') return Promise.resolve({ data: { user: { preferences: {} } } })
      return Promise.resolve({ data: {} })
    })
    renderTicket()
    await waitFor(() => expect(screen.getByText(/couldn't size from account equity/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(null)
  })

  test('instant-orders toggle persists to preferences', async () => {
    ;(api.put as Mock).mockResolvedValue({ data: {} })
    renderTicket()
    await waitFor(() => expect(screen.getByRole('switch', { name: /instant orders/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('switch', { name: /instant orders/i }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/users/me', {
        preferences: expect.objectContaining({ trading: expect.objectContaining({ instant_orders: true }) }),
      }),
    )
  })
})
```

- [ ] **Step 5: Run to verify fail** — `npx vitest run src/components/analysis/TradeTicket.test.tsx` — FAIL (module missing).

- [ ] **Step 6: Implement `TradeTicket.tsx`**

```tsx
// frontend/src/components/analysis/TradeTicket.tsx
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { sizeByRisk } from '@/lib/positionSize'
import type { BrokerConnection, Signal } from '@/types/api'

interface Prefs { trading?: { instant_orders?: boolean }; [k: string]: unknown }

export async function placeInstantOrder({ symbol, signal, connectionId, equity, riskPct }: {
  symbol: string; signal: Signal; connectionId: string; equity: number; riskPct: number
}) {
  const entry = signal.entry_price ?? 0
  const stop = signal.stop_loss ?? 0
  const quantity = sizeByRisk({ equity, riskPct, entry, stop })
  if (quantity <= 0) throw new Error('Could not size order from risk settings')
  const res = await api.post<{ order: { id: string } }>('/trading/orders', {
    broker_connection_id: connectionId,
    symbol,
    side: signal.signal_type === 'sell' ? 'sell' : 'buy',
    order_type: 'market',
    quantity,
    stop_loss: signal.stop_loss,
    take_profit: signal.take_profit,
    signal_id: signal.id,
  })
  return { orderId: res.data.order.id }
}

export function TradeTicket({ symbol, signal, currentPrice, armed = false }: {
  symbol: string; signal?: Signal | null; currentPrice?: number | null; armed?: boolean
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const connectionsQuery = useQuery({
    queryKey: ['broker-connections'],
    queryFn: async () => (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections,
  })
  const connected = (connectionsQuery.data ?? []).filter((c) => c.status === 'connected')
  const [connectionId, setConnectionId] = useState('')
  useEffect(() => {
    if (!connectionId && connected.length) setConnectionId(connected[0].id)
  }, [connected, connectionId])

  const accountQuery = useQuery({
    queryKey: ['broker-account', connectionId],
    queryFn: async () => (await api.get<{ account: { funds?: { equity?: number } } }>(`/brokers/connections/${connectionId}/accounts`)).data.account,
    enabled: !!connectionId,
  })
  const settingsQuery = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () => (await api.get<{ settings: { risk_per_trade_pct: number } }>('/auto-trading/settings')).data.settings,
  })
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<{ user: { preferences?: Prefs } }>('/users/me')).data,
  })

  const equity = accountQuery.data?.funds?.equity ?? null
  const riskPct = settingsQuery.data?.risk_per_trade_pct ?? 0.01

  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [quantity, setQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [seeded, setSeeded] = useState(false)

  // Seed from the signal once sizing inputs are available
  useEffect(() => {
    if (seeded || !signal) return
    setSide(signal.signal_type === 'sell' ? 'sell' : 'buy')
    if (signal.stop_loss != null) setStopLoss(String(signal.stop_loss))
    if (signal.take_profit != null) setTakeProfit(String(signal.take_profit))
    const entry = signal.entry_price ?? currentPrice ?? 0
    if (equity != null && signal.stop_loss != null && entry) {
      const qty = sizeByRisk({ equity, riskPct, entry, stop: signal.stop_loss })
      if (qty > 0) setQuantity(String(qty))
      setSeeded(true)
    } else if (accountQuery.isError) {
      setSeeded(true) // give up seeding quantity; leave blank
    }
  }, [signal, equity, riskPct, currentPrice, seeded, accountQuery.isError])

  const instantOrders = Boolean(meQuery.data?.user.preferences?.trading?.instant_orders)
  const toggleInstant = async (checked: boolean) => {
    const prefs = { ...(meQuery.data?.user.preferences ?? {}) }
    prefs.trading = { ...(prefs.trading ?? {}), instant_orders: checked }
    await api.put('/users/me', { preferences: prefs })
    void queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  const orderMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/trading/orders', payload),
    onSuccess: () => {
      toast('Order placed', 'success')
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err) => toast(getApiErrorMessage(err), 'error'),
  })

  const submit = () => {
    const payload: Record<string, unknown> = {
      broker_connection_id: connectionId,
      symbol,
      side,
      order_type: orderType,
      quantity: Number(quantity),
    }
    if (orderType === 'limit' && limitPrice) payload.price = Number(limitPrice)
    if (stopLoss) payload.stop_loss = Number(stopLoss)
    if (takeProfit) payload.take_profit = Number(takeProfit)
    if (signal?.id) payload.signal_id = signal.id
    orderMutation.mutate(payload)
  }

  return (
    <Card className={armed ? 'border-primary' : undefined}>
      <CardHeader>
        <CardTitle>Trade {symbol}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button type="button" data-active={side === 'buy'} variant={side === 'buy' ? 'default' : 'outline'} onClick={() => setSide('buy')} className="flex-1">Buy</Button>
          <Button type="button" data-active={side === 'sell'} variant={side === 'sell' ? 'default' : 'outline'} onClick={() => setSide('sell')} className="flex-1">Sell</Button>
        </div>

        <Select
          value={connectionId}
          onValueChange={setConnectionId}
          placeholder="Broker connection"
          options={connected.map((c) => ({ value: c.id, label: `${c.name} (${c.broker_id})` }))}
        />

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Quantity
            <Input aria-label="quantity" type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Order type
            <Select value={orderType} onValueChange={(v) => setOrderType(v as 'market' | 'limit')} options={[{ value: 'market', label: 'Market' }, { value: 'limit', label: 'Limit' }]} />
          </label>
          {orderType === 'limit' && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Limit price
              <Input aria-label="limit price" type="number" step="any" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Stop loss
            <Input aria-label="stop loss" type="number" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Take profit
            <Input aria-label="take profit" type="number" step="any" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
          </label>
        </div>

        {accountQuery.isError && (
          <p className="text-xs text-danger">Couldn't size from account equity — enter a quantity manually.</p>
        )}
        {equity != null && quantity && Number(quantity) > 0 && (currentPrice ?? signal?.entry_price) != null && (
          <p className="text-xs text-muted">
            Est. {side === 'buy' ? 'cost' : 'proceeds'}: ${(Number(quantity) * (currentPrice ?? signal!.entry_price!)).toFixed(2)} · Equity: ${equity.toFixed(0)}
          </p>
        )}

        <Button type="button" onClick={submit} disabled={orderMutation.isPending || !connectionId || !quantity}>
          {orderMutation.isPending ? 'Placing…' : `Confirm ${side}`}
        </Button>

        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-muted">Instant orders from signal cards</span>
          <Switch aria-label="Instant orders from signal cards" checked={instantOrders} onCheckedChange={(c) => void toggleInstant(c)} />
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 7: Run to verify they pass** — `npx vitest run src/components/analysis/TradeTicket.test.tsx src/lib/positionSize.test.ts` — expect PASS. Adjust label queries only if the `Select` primitive renders differently (check `frontend/src/components/ui/select.tsx` for its accessible name behavior).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/positionSize.ts frontend/src/lib/positionSize.test.ts frontend/src/components/analysis/TradeTicket.tsx frontend/src/components/analysis/TradeTicket.test.tsx
git commit -m "feat: risk-sized trade ticket with bracket orders and instant-orders preference"
```

---

### Task 10: SymbolAnalysisPage + route

**Files:**
- Create: `frontend/src/pages/analysis/SymbolAnalysisPage.tsx`
- Modify: `frontend/src/router.tsx` (add `{ path: '/analyze/:symbol', element: <SymbolAnalysisPage /> }` inside the same protected children group as `/market`)
- Test: `frontend/src/pages/analysis/SymbolAnalysisPage.test.tsx`

**Interfaces:**
- Consumes: `useCandles`/`mergeLivePrice` (Task 6), `useLivePrices` (existing), `AnalysisChart` (Task 7), `IndicatorManager`/`useChartLayout` (Task 8), `TradeTicket` (Task 9), `GET /analysis/latest/:symbol` → `{ signal }` (404 when none), `GET /analysis/signals/:id`.
- Produces: the page. URL contract: `/analyze/:symbol?signal=<id>&arm=1&tf=<timeframe>`.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/pages/analysis/SymbolAnalysisPage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { SymbolAnalysisPage } from './SymbolAnalysisPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  API_BASE_URL: 'http://localhost:3001',
  getApiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error'),
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/hooks/useWebSocket', () => ({ useLivePrices: () => ({}) }))
vi.mock('@/components/analysis/AnalysisChart', () => ({
  AnalysisChart: (props: { candles: unknown[]; signal?: { id?: string } | null }) => (
    <div data-testid="analysis-chart" data-signal={props.signal?.id ?? ''} data-count={props.candles.length} />
  ),
}))

const SIGNAL = {
  id: 'sig-1', symbol: 'AAPL', signal_type: 'buy', confidence: 82,
  entry_price: 150, stop_loss: 145, take_profit: 160,
  analysis_text: 'Momentum breakout with rising volume',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
}

function mockApi({ latestSignal = SIGNAL, expired = false }: { latestSignal?: typeof SIGNAL | null; expired?: boolean } = {}) {
  const sig = latestSignal && expired ? { ...latestSignal, expires_at: new Date(Date.now() - 1000).toISOString() } : latestSignal
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url.startsWith('/market/history/')) {
      return Promise.resolve({ data: { has_more: false, data: { candles: [{ time: new Date().toISOString(), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }], current_price: 150.2, previous_close: 149 } } })
    }
    if (url === '/analysis/latest/AAPL') {
      return sig ? Promise.resolve({ data: { symbol: 'AAPL', signal: sig } }) : Promise.reject(Object.assign(new Error('not found'), { response: { status: 404 } }))
    }
    if (url === '/analysis/signals/sig-1') return Promise.resolve({ data: { signal: sig } })
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections: [] } })
    if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings: { risk_per_trade_pct: 0.01 } } })
    if (url === '/users/me') return Promise.resolve({ data: { user: { preferences: {} } } })
    return Promise.resolve({ data: {} })
  })
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/analyze/:symbol" element={<SymbolAnalysisPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('SymbolAnalysisPage', () => {
  test('renders chart, signal summary and ticket from the latest signal', async () => {
    mockApi()
    renderAt('/analyze/AAPL')
    expect(await screen.findByTestId('analysis-chart')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('analysis-chart')).toHaveAttribute('data-signal', 'sig-1'))
    expect(screen.getByText(/momentum breakout/i)).toBeInTheDocument()
    expect(screen.getByText(/82/)).toBeInTheDocument()
    expect(screen.getByText(/Trade AAPL/i)).toBeInTheDocument()
  })

  test('timeframe tab switch refetches history with the new interval', async () => {
    mockApi()
    renderAt('/analyze/AAPL')
    await screen.findByTestId('analysis-chart')
    fireEvent.click(screen.getByRole('button', { name: '15m' }))
    await waitFor(() =>
      expect((api.get as Mock).mock.calls.some(([url, cfg]) => url === '/market/history/AAPL' && cfg?.params?.interval === '15m')).toBe(true),
    )
  })

  test('no signal: chart renders, summary says no signal', async () => {
    mockApi({ latestSignal: null })
    renderAt('/analyze/AAPL')
    expect(await screen.findByTestId('analysis-chart')).toBeInTheDocument()
    expect(screen.getByText(/no ai signal/i)).toBeInTheDocument()
  })

  test('expired signal shows the stale banner', async () => {
    mockApi({ expired: true })
    renderAt('/analyze/AAPL')
    expect(await screen.findByText(/signal expired/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/pages/analysis/SymbolAnalysisPage.test.tsx` — FAIL (module missing).

- [ ] **Step 3: Implement the page**

```tsx
// frontend/src/pages/analysis/SymbolAnalysisPage.tsx
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnalysisChart } from '@/components/analysis/AnalysisChart'
import { IndicatorManager } from '@/components/analysis/IndicatorManager'
import { TradeTicket } from '@/components/analysis/TradeTicket'
import { useCandles, mergeLivePrice } from '@/hooks/useCandles'
import { useChartLayout } from '@/hooks/useChartLayout'
import { useLivePrices } from '@/hooks/useWebSocket'
import { api } from '@/lib/api'
import { formatDate, signalBadgeVariant } from '@/lib/format'
import type { Signal } from '@/types/api'

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d']

export function SymbolAnalysisPage() {
  const { symbol = '' } = useParams()
  const [searchParams] = useSearchParams()
  const signalId = searchParams.get('signal')
  const armed = searchParams.get('arm') === '1'
  const [timeframe, setTimeframe] = useState(searchParams.get('tf') || '1h')
  const [logScale, setLogScale] = useState(false)
  const [showSignal, setShowSignal] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)

  const { candles, currentPrice, isLoading, hasMore, loadOlder } = useCandles(symbol, timeframe)
  const livePrices = useLivePrices(useMemo(() => [symbol], [symbol]))
  const liveCandles = useMemo(
    () => mergeLivePrice(candles, livePrices[symbol]?.price ?? null),
    [candles, livePrices, symbol],
  )

  const signalQuery = useQuery({
    queryKey: ['analysis-signal', symbol, signalId],
    queryFn: async () => {
      if (signalId) return (await api.get<{ signal: Signal }>(`/analysis/signals/${signalId}`)).data.signal
      const res = await api.get<{ signal: Signal }>(`/analysis/latest/${symbol}`)
      return res.data.signal
    },
    retry: false,
  })
  const signal = signalQuery.data ?? null
  const expired = Boolean(signal?.expires_at && new Date(signal.expires_at).getTime() < Date.now())

  const { layout, setLayout } = useChartLayout()

  return (
    <div className={`flex flex-col gap-4 ${fullscreen ? 'fixed inset-0 z-50 bg-background p-4' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-foreground">
          {symbol} <span className="text-sm font-normal text-muted">{currentPrice != null ? `$${currentPrice}` : ''}</span>
        </h1>
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                timeframe === tf ? 'border-primary bg-primary/20 text-primary' : 'border-border bg-card text-muted hover:text-foreground'
              }`}
            >
              {tf}
            </button>
          ))}
          <button type="button" onClick={() => setLogScale((v) => !v)} className="ml-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted hover:text-foreground">
            {logScale ? 'log' : 'lin'}
          </button>
          <button type="button" onClick={() => setFullscreen((v) => !v)} className="rounded-full border border-border bg-card px-3 py-1 text-sm text-muted hover:text-foreground">
            {fullscreen ? 'exit' : 'full'}
          </button>
        </div>
      </div>

      {expired && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning">
          Signal expired — prices may be stale.
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <IndicatorManager value={layout} onChange={setLayout} />
          {isLoading ? (
            <p className="text-sm text-muted">Loading chart…</p>
          ) : (
            <AnalysisChart
              candles={liveCandles}
              indicators={layout}
              signal={signal}
              showSignal={showSignal}
              logScale={logScale}
              onReachOldest={hasMore ? loadOlder : undefined}
            />
          )}
        </div>

        <div className="flex w-full flex-col gap-4 lg:w-96">
          <Card>
            <CardHeader>
              <CardTitle>AI signal</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {signal ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant={signalBadgeVariant(signal.signal_type)}>{signal.signal_type}</Badge>
                    <span className="text-foreground">{signal.confidence}% confidence</span>
                    <button
                      type="button"
                      onClick={() => setShowSignal((v) => !v)}
                      className="ml-auto text-xs text-muted hover:text-foreground"
                    >
                      {showSignal ? 'hide on chart' : 'show on chart'}
                    </button>
                  </div>
                  <p className="text-muted">{signal.analysis_text}</p>
                  <p className="text-xs text-muted">
                    Entry {signal.entry_price ?? '—'} · Stop {signal.stop_loss ?? '—'} · Target {signal.take_profit ?? '—'}
                  </p>
                  {signal.created_at && <p className="text-xs text-muted">Generated {formatDate(signal.created_at)}</p>}
                </>
              ) : (
                <p className="text-muted">No AI signal for {symbol} yet. Generate one from the Signals page, or trade manually below.</p>
              )}
            </CardContent>
          </Card>

          <TradeTicket symbol={symbol} signal={signal} currentPrice={currentPrice} armed={armed} />
        </div>
      </div>
    </div>
  )
}
```

If `text-warning`/`bg-warning` tokens don't exist in the Tailwind theme, use `text-amber-500 border-amber-500/40 bg-amber-500/10` instead — check `frontend/tailwind.config.*` first.

Then add the route in `frontend/src/router.tsx` next to `/market`:

```tsx
import { SymbolAnalysisPage } from '@/pages/analysis/SymbolAnalysisPage'
// inside the protected children array:
{ path: '/analyze/:symbol', element: <SymbolAnalysisPage /> },
```

- [ ] **Step 4: Run to verify they pass** — `npx vitest run src/pages/analysis/SymbolAnalysisPage.test.tsx` and `npx tsc --noEmit` — expect PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/analysis/SymbolAnalysisPage.tsx frontend/src/pages/analysis/SymbolAnalysisPage.test.tsx frontend/src/router.tsx
git commit -m "feat: symbol analysis page - chart, AI signal summary, trade ticket"
```

---

### Task 11: Entry points — signal card Buy/Sell + links

**Files:**
- Modify: `frontend/src/pages/signals/SignalsPage.tsx` (Buy/Sell buttons + analyze link on each signal card/row)
- Modify: `frontend/src/pages/DashboardPage.tsx` (same treatment on its signal list)
- Modify: `frontend/src/pages/market/MarketPage.tsx` (symbol → analyze link)
- Test: `frontend/src/pages/signals/SignalsPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `placeInstantOrder` from `@/components/analysis/TradeTicket` (Task 9), `prefetchCandles` from `@/hooks/useCandles` (Task 6), instant-orders preference from `GET /users/me`.
- Produces: a shared `SignalTradeButtons` component (create in `frontend/src/components/analysis/SignalTradeButtons.tsx`, used by both pages):
  ```ts
  function SignalTradeButtons({ signal }: { signal: Signal }): JSX.Element
  ```
  Behavior: renders `Buy`/`Sell` (side matching `signal.signal_type` highlighted). Click → if instant mode off, `navigate('/analyze/SYM?signal=<id>&arm=1')`; if on, resolve first connected connection + equity + risk pct, call `placeInstantOrder`, toast result. `onMouseEnter` of either button prefetches candles.

- [ ] **Step 1: Read both signal card render sites** — open `SignalsPage.tsx` and `DashboardPage.tsx`, find where each signal renders (look for `signal.symbol` / `signal_type`). Note the JSX shape — the buttons drop in beside the existing badge/CTA area.

- [ ] **Step 2: Write the failing tests** (extend `SignalsPage.test.tsx`, following its existing mock setup; add `useNavigate` spy):

```tsx
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => mockNavigate,
}))

test('Buy navigates to the armed analysis page when instant mode is off', async () => {
  mockApiGet() // existing helper; ensure /users/me returns preferences: {}
  renderPage()
  const buy = (await screen.findAllByRole('button', { name: /^buy$/i }))[0]
  fireEvent.click(buy)
  expect(mockNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/analyze\/[A-Z.]+\?signal=.+&arm=1$/))
})

test('Buy places the order immediately when instant mode is on', async () => {
  mockApiGet({
    me: { user: { preferences: { trading: { instant_orders: true } } } },
    connections: [{ id: 'conn-1', name: 'Alpaca', broker_id: 'alpaca', status: 'connected' }],
    account: { funds: { equity: 100000 } },
    settings: { risk_per_trade_pct: 0.01 },
  })
  ;(api.post as Mock).mockResolvedValue({ data: { order: { id: 'order-9' } } })
  renderPage()
  const buy = (await screen.findAllByRole('button', { name: /^buy$/i }))[0]
  fireEvent.click(buy)
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/trading/orders', expect.objectContaining({ side: 'buy', signal_id: expect.any(String) })))
  expect(mockNavigate).not.toHaveBeenCalled()
})
```

Extend the file's `mockApiGet` helper so `/users/me`, `/brokers/connections`, `/brokers/connections/:id/accounts`, and `/auto-trading/settings` are mockable with the override object shown (default: instant off, no connections).

- [ ] **Step 3: Run to verify fail** — `npx vitest run src/pages/signals/SignalsPage.test.tsx` — expect the two new tests FAIL (no Buy button yet).

- [ ] **Step 4: Implement `SignalTradeButtons`**

```tsx
// frontend/src/components/analysis/SignalTradeButtons.tsx
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { api, getApiErrorMessage } from '@/lib/api'
import { prefetchCandles } from '@/hooks/useCandles'
import { placeInstantOrder } from '@/components/analysis/TradeTicket'
import type { BrokerConnection, Signal } from '@/types/api'

export function SignalTradeButtons({ signal }: { signal: Signal }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<{ user: { preferences?: { trading?: { instant_orders?: boolean } } } }>('/users/me')).data,
    staleTime: 60_000,
  })
  const instant = Boolean(meQuery.data?.user.preferences?.trading?.instant_orders)

  const go = () => navigate(`/analyze/${signal.symbol}?signal=${signal.id}&arm=1`)

  const fire = async (side: 'buy' | 'sell') => {
    if (!instant) return go()
    try {
      const connections = (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections
      const conn = connections.find((c) => c.status === 'connected')
      if (!conn) throw new Error('No connected broker')
      const account = (await api.get<{ account: { funds?: { equity?: number } } }>(`/brokers/connections/${conn.id}/accounts`)).data.account
      const settings = (await api.get<{ settings: { risk_per_trade_pct: number } }>('/auto-trading/settings')).data.settings
      const { orderId } = await placeInstantOrder({
        symbol: signal.symbol,
        signal: { ...signal, signal_type: side },
        connectionId: conn.id,
        equity: account.funds?.equity ?? 0,
        riskPct: settings.risk_per_trade_pct ?? 0.01,
      })
      toast(`Order placed (${orderId.slice(0, 8)}…)`, 'success')
    } catch (err) {
      toast(getApiErrorMessage(err), 'error')
    }
  }

  const prefetch = () => prefetchCandles(queryClient, signal.symbol)
  const suggested = signal.signal_type === 'sell' ? 'sell' : 'buy'

  return (
    <span className="flex gap-1.5" onMouseEnter={prefetch}>
      <Button type="button" size="sm" variant={suggested === 'buy' ? 'default' : 'outline'} onClick={() => void fire('buy')}>
        Buy
      </Button>
      <Button type="button" size="sm" variant={suggested === 'sell' ? 'default' : 'outline'} onClick={() => void fire('sell')}>
        Sell
      </Button>
    </span>
  )
}
```

Drop `<SignalTradeButtons signal={signal} />` into each signal card in `SignalsPage.tsx` and `DashboardPage.tsx` (beside the existing badge/CTA area), and make the signal's symbol text a `<Link to={`/analyze/${signal.symbol}?signal=${signal.id}`}>`. In `MarketPage.tsx`, wrap the symbol cell in `<Link to={`/analyze/${row.symbol}`}>` with `onMouseEnter={() => prefetchCandles(queryClient, row.symbol)}`.

- [ ] **Step 5: Run to verify** — `npx vitest run src/pages/signals/SignalsPage.test.tsx src/pages/DashboardPage.test.tsx src/pages/market/MarketPage.test.tsx` — new tests PASS, existing tests still green (fix any that assert on the old card markup — keep their intent, update selectors).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/analysis/SignalTradeButtons.tsx frontend/src/pages/signals/SignalsPage.tsx frontend/src/pages/DashboardPage.tsx frontend/src/pages/market/MarketPage.tsx frontend/src/pages/signals/SignalsPage.test.tsx
git commit -m "feat: one-click Buy/Sell on signal cards with instant-mode and analyze links"
```

---

### Task 12: Full-suite verification + manual paper check

**Files:** none new.

- [ ] **Step 1: Full suites** — `cd backend && npm test` then `cd ../frontend && npx vitest run && npm run lint && npx tsc --noEmit`. Expected: all green; lint may show the 6 pre-existing errors (PlaceOrderDialog ×2, dropdown-menu ×2, tabs ×1, AutoTradingPage ×1) — no NEW errors allowed.

- [ ] **Step 2: Manual verification (paper account)** — with docker postgres/redis up and both dev servers running:
  1. Open `/analyze/NVDA` — chart paints, indicators from default layout render, timeframe tabs switch.
  2. Open a signal from the Signals page — entry/stop/target lines appear; ticket pre-filled; place a paper order via Confirm; verify it lands on Orders page with SL/TP.
  3. Toggle instant orders on; click Buy on a signal card; verify immediate order + toast.
  4. Cancel an `open` order from the Orders page (Task 1).
  5. Pan the chart left until older candles load.

- [ ] **Step 3: Commit any test/lint fixups, then push**

```bash
git push
```

---

## Self-review notes (done at plan time)

- Spec coverage: page/routing (T10), data path incl. cursor+prefetch+WS merge (T2, T6), indicator library + parity (T3–T5), chart features (T7; fullscreen/log/tabs in T10), saved layouts (T8), signal overlay (T7), ticket + instant orders (T9, T11), error handling (T9/T10 tests), cancel-orders gap (T1), v2 backlog untouched.
- Deliberate simplifications vs spec wording: live candles reuse the existing `price` WS channel via client-side merge (no new server channel — the server already polls Alpaca every 5s for subscribed symbols, which is the same freshness a dedicated channel would have); drag-resizable panes are dropped from v1 (lightweight-charts panes are resizable by its own separator UI by default — verify during T7 manual check; if absent, accept fixed heights for v1).
- Type consistency: `IndicatorConfig`/`SeriesPoint` defined once in `types.ts`; `Candle`/`Signal` from `@/types/api`; order body snake_case everywhere; `getHistoricalPage` response shape identical in T2 service, route, and T6 hook.
