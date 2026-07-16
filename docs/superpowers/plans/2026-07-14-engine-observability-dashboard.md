# Engine Observability Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, evaluation-led engine observability dashboard at `/auto-trading/dashboard` with seven panels backed by new SQL-aggregation endpoints.

**Architecture:** New read-only endpoints added to the existing `backend/src/routes/autoTrading.js` router (already mounted at `/api/auto-trading`), each a plain aggregation `SELECT` over `auto_trading_runs`, `benchmark_snapshots`, and `positions`. A new React page composes one focused component per panel; components that share the `/metrics` payload use a single shared react-query hook so the endpoint is fetched once. No schema changes, no mutations.

**Tech Stack:** Backend — Express, `pg-promise` (`db.one`/`db.oneOrNone`/`db.manyOrNone`/`db.none`), `express-validator`, Jest + Supertest. Frontend — React, `react-router-dom`, `@tanstack/react-query`, TypeScript, Tailwind v4, shadcn-style primitives in `src/components/ui/`, Vitest + Testing Library.

## Global Constraints

- All new endpoints live in `backend/src/routes/autoTrading.js`, are `authenticate`-gated, and scope every query to `req.user.id`. Copy this pattern from the existing endpoints.
- Every aggregation endpoint **fails closed**: missing/empty data returns empty arrays / `null` aggregates and HTTP 200 — never a 500 that breaks the page.
- The circuit-breaker threshold is `CIRCUIT_BREAKER_ERROR_THRESHOLD` (value `5`), exported from `backend/src/services/autoTradingEngine.js`. Import it — never hardcode `5`.
- Engine-source attribution is by **symbol-correlation**: a position is "engine" if its symbol has `order_placed` engine runs — the exact subquery `SELECT DISTINCT symbol FROM auto_trading_runs WHERE user_id = $1 AND action = 'order_placed'`. This mirrors the existing `/status` `todays_pnl` logic. It is approximate; the UI notes "attributed by symbol".
- Postgres `COUNT(*)` returns a string via pg — cast counts with `::int` in SQL and/or `parseInt`; cast `AVG`/`SUM` numerics with `parseFloat`. Follow the existing `/status` and `/benchmark` handlers.
- Backend tests go under `backend/src/__tests__/phase10/`, mirroring `backend/src/__tests__/phase8/autoTradingRoutesV2.test.js` (Supertest app + `jest.mock('../../config/database')` + `jest.mock('../../middleware/auth')`).
- Frontend panel components go under `frontend/src/components/engine/`; the page is `frontend/src/pages/trading/EngineDashboardPage.tsx`. Tests are colocated `*.test.tsx`, mirroring `AutoTradingPage.test.tsx` (mock `@/lib/api`).
- Run backend tests with `cd backend && npx jest <path>`; frontend with `cd frontend && npx vitest run <path>`.
- Money values render with `formatCurrency`; fraction rates (0–1, e.g. win_rate) with `formatPercent` (it multiplies values ≤1 by 100); already-scaled percents (e.g. `return_pct` = 4.2) with `` `${v.toFixed(2)}%` `` (stable 2-dp — `formatNumber` drops trailing zeros); confidence (0–100) with `` `${formatNumber(v, 0)}%` ``.

---

### Task 1: Backend `GET /auto-trading/metrics`

Powers the health strip, performance KPIs, decision breakdown, and average confidence in one call.

**Files:**
- Modify: `backend/src/routes/autoTrading.js` (add handler + import the constant)
- Test: `backend/src/__tests__/phase10/metricsRoute.test.js`

**Interfaces:**
- Consumes: existing `db`, `authenticate`, `asyncHandler`, `getAutoTradingSettings`, and `CIRCUIT_BREAKER_ERROR_THRESHOLD` (add to the existing require from `../services/autoTradingEngine`).
- Produces: `GET /api/auto-trading/metrics` →
  ```json
  {
    "health": { "enabled": true, "last_run_at": "2026-07-14T12:00:00.000Z", "errors_24h": 0, "circuit_breaker_threshold": 5, "trades_today": 2 },
    "performance": { "return_pct": 4.2, "vs_buy_hold_pct": 1.1, "win_rate": 0.61, "trades": 18 },
    "decision_breakdown": [ { "action": "order_placed", "count": 12 } ],
    "avg_confidence": 64.5
  }
  ```
  `return_pct` / `vs_buy_hold_pct` are `null` when fewer than 2 benchmark snapshots exist; `win_rate` is `null` when there are 0 closed attributed positions; `avg_confidence` is `null` when no run has a confidence.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase10/metricsRoute.test.js`:

```js
const request = require('supertest');
const express = require('express');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

const autoTradingRouter = require('../../routes/autoTrading');
const app = express();
app.use(express.json());
app.use('/api/auto-trading', autoTradingRouter);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.one.mockResolvedValue({});
  mockDb.oneOrNone.mockResolvedValue(null);
  mockDb.manyOrNone.mockResolvedValue([]);
});

describe('GET /api/auto-trading/metrics', () => {
  test('assembles health, performance, decision breakdown and avg confidence', async () => {
    // Order matters: the positions win-rate query also contains "action =
    // 'order_placed'" in its attribution subquery, so match it (AS wins) first.
    mockDb.one.mockImplementation((sql) => {
      if (sql.includes('FROM users')) return Promise.resolve({ preferences: { auto_trading: { enabled: true } } });
      if (sql.includes('AS wins')) return Promise.resolve({ wins: '11', total: '18' });
      if (sql.includes('CURRENT_DATE')) return Promise.resolve({ count: '2' });
      if (sql.includes("IN ('error'")) return Promise.resolve({ count: '0' });
      if (sql.includes('AVG(confidence)')) return Promise.resolve({ avg: '64.5' });
      if (sql.includes("action = 'order_placed'")) return Promise.resolve({ count: '18' });
      return Promise.resolve({});
    });
    mockDb.oneOrNone.mockResolvedValue({ created_at: '2026-07-14T12:00:00.000Z' });
    mockDb.manyOrNone.mockImplementation((sql) => {
      if (sql.includes('GROUP BY action')) return Promise.resolve([{ action: 'order_placed', count: 12 }]);
      if (sql.includes('FROM benchmark_snapshots')) return Promise.resolve([
        { engine_equity: '100000.00', watchlist_value: '100000.00' },
        { engine_equity: '104200.00', watchlist_value: '103100.00' },
      ]);
      return Promise.resolve([]);
    });

    const res = await request(app).get('/api/auto-trading/metrics');
    expect(res.status).toBe(200);
    expect(res.body.health).toEqual({
      enabled: true, last_run_at: '2026-07-14T12:00:00.000Z', errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 2,
    });
    expect(res.body.performance.return_pct).toBeCloseTo(4.2, 3);
    expect(res.body.performance.vs_buy_hold_pct).toBeCloseTo(1.1, 3);
    expect(res.body.performance.win_rate).toBeCloseTo(11 / 18, 4);
    expect(res.body.performance.trades).toBe(18);
    expect(res.body.decision_breakdown).toEqual([{ action: 'order_placed', count: 12 }]);
    expect(res.body.avg_confidence).toBe(64.5);
  });

  test('returns null performance ratios when fewer than two snapshots', async () => {
    mockDb.one.mockImplementation((sql) => {
      if (sql.includes('FROM users')) return Promise.resolve({ preferences: {} });
      if (sql.includes('FROM positions')) return Promise.resolve({ wins: '0', total: '0' });
      if (sql.includes('AVG(confidence)')) return Promise.resolve({ avg: null });
      return Promise.resolve({ count: '0' });
    });
    mockDb.manyOrNone.mockResolvedValue([]);
    const res = await request(app).get('/api/auto-trading/metrics');
    expect(res.status).toBe(200);
    expect(res.body.performance.return_pct).toBeNull();
    expect(res.body.performance.vs_buy_hold_pct).toBeNull();
    expect(res.body.performance.win_rate).toBeNull();
    expect(res.body.avg_confidence).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/phase10/metricsRoute.test.js`
Expected: FAIL — 404 (route not defined), assertions error.

- [ ] **Step 3: Add the constant to the existing require**

In `backend/src/routes/autoTrading.js`, change the existing autoTradingEngine import line:

```js
const { getAutoTradingSettings, CIRCUIT_BREAKER_ERROR_THRESHOLD } = require('../services/autoTradingEngine');
```

- [ ] **Step 4: Implement the handler**

Insert before `module.exports = router;` in `backend/src/routes/autoTrading.js`:

```js
// ── GET /api/auto-trading/metrics ─────────────────────────────────────────────
// Read-only rollup: health strip + performance KPIs + decision breakdown.

router.get('/metrics', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const ATTRIBUTED = `SELECT DISTINCT symbol FROM auto_trading_runs WHERE user_id = $1 AND action = 'order_placed'`;

  const user = await db.one('SELECT preferences FROM users WHERE id = $1', [userId]);
  const settings = getAutoTradingSettings(user.preferences);

  const lastRun = await db.oneOrNone(
    `SELECT created_at FROM auto_trading_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
  const errors = await db.one(
    `SELECT COUNT(*) FROM auto_trading_runs WHERE user_id = $1 AND action IN ('error','needs_attention','auto_disabled_errors') AND created_at >= NOW() - INTERVAL '24 hours'`, [userId]);
  const tradesToday = await db.one(
    `SELECT COUNT(*) FROM auto_trading_runs WHERE user_id = $1 AND action = 'order_placed' AND created_at >= CURRENT_DATE`, [userId]);
  const tradesTotal = await db.one(
    `SELECT COUNT(*) FROM auto_trading_runs WHERE user_id = $1 AND action = 'order_placed'`, [userId]);
  const avgConf = await db.one(
    `SELECT AVG(confidence) AS avg FROM auto_trading_runs WHERE user_id = $1 AND confidence IS NOT NULL`, [userId]);
  const breakdown = await db.manyOrNone(
    `SELECT action, COUNT(*)::int AS count FROM auto_trading_runs WHERE user_id = $1 GROUP BY action ORDER BY count DESC`, [userId]);
  const wl = await db.one(
    `SELECT COUNT(*) FILTER (WHERE pnl > 0)::int AS wins, COUNT(*)::int AS total
       FROM positions WHERE user_id = $1 AND status = 'closed' AND symbol IN (${ATTRIBUTED})`, [userId]);
  const snaps = await db.manyOrNone(
    `SELECT engine_equity, watchlist_value FROM benchmark_snapshots WHERE user_id = $1 ORDER BY snapshot_date ASC`, [userId]);

  let returnPct = null;
  let vsBuyHoldPct = null;
  if (snaps.length >= 2) {
    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    const e0 = parseFloat(first.engine_equity);
    const e1 = parseFloat(last.engine_equity);
    const w0 = parseFloat(first.watchlist_value);
    const w1 = parseFloat(last.watchlist_value);
    if (e0 > 0) returnPct = ((e1 - e0) / e0) * 100;
    if (e0 > 0 && w0 > 0) vsBuyHoldPct = returnPct - ((w1 - w0) / w0) * 100;
  }

  res.json({
    health: {
      enabled: settings.enabled,
      last_run_at: lastRun?.created_at || null,
      errors_24h: parseInt(errors.count, 10),
      circuit_breaker_threshold: CIRCUIT_BREAKER_ERROR_THRESHOLD,
      trades_today: parseInt(tradesToday.count, 10),
    },
    performance: {
      return_pct: returnPct,
      vs_buy_hold_pct: vsBuyHoldPct,
      win_rate: parseInt(wl.total, 10) > 0 ? parseInt(wl.wins, 10) / parseInt(wl.total, 10) : null,
      trades: parseInt(tradesTotal.count, 10),
    },
    decision_breakdown: breakdown,
    avg_confidence: avgConf.avg != null ? parseFloat(avgConf.avg) : null,
  });
}));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/phase10/metricsRoute.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/autoTrading.js backend/src/__tests__/phase10/metricsRoute.test.js
git commit -m "feat: engine dashboard metrics endpoint (health, performance, breakdown)"
```

---

### Task 2: Backend `GET /auto-trading/symbol-performance`

**Files:**
- Modify: `backend/src/routes/autoTrading.js`
- Test: `backend/src/__tests__/phase10/symbolPerformanceRoute.test.js`

**Interfaces:**
- Produces: `GET /api/auto-trading/symbol-performance` →
  ```json
  { "symbols": [ { "symbol": "NVDA", "trades": 7, "win_rate": 0.71, "realized_pnl": 412.0, "unrealized_pnl": 120.0, "avg_confidence": 68.0, "last_action": "order_placed", "last_action_at": "2026-07-14T12:00:00.000Z" } ] }
  ```
  Rows are the symbols that appear in `auto_trading_runs` (engine-analyzed), sorted by `trades` desc then `symbol` asc. `win_rate` is `null` when the symbol has 0 closed positions.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase10/symbolPerformanceRoute.test.js`:

```js
const request = require('supertest');
const express = require('express');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

const autoTradingRouter = require('../../routes/autoTrading');
const app = express();
app.use(express.json());
app.use('/api/auto-trading', autoTradingRouter);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.one.mockResolvedValue({ preferences: {} });
});

describe('GET /api/auto-trading/symbol-performance', () => {
  test('merges run stats with position P&L per symbol', async () => {
    mockDb.manyOrNone.mockImplementation((sql) => {
      if (sql.includes('FROM auto_trading_runs')) return Promise.resolve([
        { symbol: 'NVDA', trades: 7, avg_confidence: '68', last_action: 'order_placed', last_action_at: '2026-07-14T12:00:00.000Z' },
        { symbol: 'AAPL', trades: 4, avg_confidence: '59', last_action: 'skipped_low_confidence', last_action_at: '2026-07-14T12:05:00.000Z' },
      ]);
      if (sql.includes('FROM positions')) return Promise.resolve([
        { symbol: 'NVDA', realized_pnl: '412.00', unrealized_pnl: '120.00', wins: '5', closed: '7' },
        { symbol: 'AAPL', realized_pnl: '-83.00', unrealized_pnl: '0.00', wins: '2', closed: '4' },
      ]);
      return Promise.resolve([]);
    });

    const res = await request(app).get('/api/auto-trading/symbol-performance');
    expect(res.status).toBe(200);
    expect(res.body.symbols[0]).toEqual({
      symbol: 'NVDA', trades: 7, win_rate: 5 / 7, realized_pnl: 412, unrealized_pnl: 120,
      avg_confidence: 68, last_action: 'order_placed', last_action_at: '2026-07-14T12:00:00.000Z',
    });
    expect(res.body.symbols[1].symbol).toBe('AAPL');
    expect(res.body.symbols[1].realized_pnl).toBe(-83);
  });

  test('win_rate is null for a symbol with no closed positions', async () => {
    mockDb.manyOrNone.mockImplementation((sql) => {
      if (sql.includes('FROM auto_trading_runs')) return Promise.resolve([
        { symbol: 'TSLA', trades: 0, avg_confidence: null, last_action: 'hold', last_action_at: '2026-07-14T12:00:00.000Z' },
      ]);
      return Promise.resolve([]);
    });
    const res = await request(app).get('/api/auto-trading/symbol-performance');
    expect(res.body.symbols[0].win_rate).toBeNull();
    expect(res.body.symbols[0].realized_pnl).toBe(0);
    expect(res.body.symbols[0].avg_confidence).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/phase10/symbolPerformanceRoute.test.js`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the handler**

Insert before `module.exports = router;` in `backend/src/routes/autoTrading.js`:

```js
// ── GET /api/auto-trading/symbol-performance ──────────────────────────────────

router.get('/symbol-performance', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const runRows = await db.manyOrNone(
    `SELECT symbol,
        COUNT(*) FILTER (WHERE action = 'order_placed')::int AS trades,
        AVG(confidence) AS avg_confidence,
        (ARRAY_AGG(action ORDER BY created_at DESC))[1] AS last_action,
        MAX(created_at) AS last_action_at
       FROM auto_trading_runs WHERE user_id = $1 GROUP BY symbol`, [userId]);

  const posRows = await db.manyOrNone(
    `SELECT symbol,
        COALESCE(SUM(pnl) FILTER (WHERE status = 'closed'), 0) AS realized_pnl,
        COALESCE(SUM(pnl) FILTER (WHERE status = 'open'), 0) AS unrealized_pnl,
        COUNT(*) FILTER (WHERE status = 'closed' AND pnl > 0)::int AS wins,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed
       FROM positions WHERE user_id = $1 GROUP BY symbol`, [userId]);

  const pnlBySymbol = new Map(posRows.map((r) => [r.symbol, r]));

  const symbols = runRows.map((r) => {
    const p = pnlBySymbol.get(r.symbol);
    const closed = p ? parseInt(p.closed, 10) : 0;
    const wins = p ? parseInt(p.wins, 10) : 0;
    return {
      symbol: r.symbol,
      trades: r.trades,
      win_rate: closed > 0 ? wins / closed : null,
      realized_pnl: p ? parseFloat(p.realized_pnl) : 0,
      unrealized_pnl: p ? parseFloat(p.unrealized_pnl) : 0,
      avg_confidence: r.avg_confidence != null ? parseFloat(r.avg_confidence) : null,
      last_action: r.last_action,
      last_action_at: r.last_action_at,
    };
  }).sort((a, b) => b.trades - a.trades || a.symbol.localeCompare(b.symbol));

  res.json({ symbols });
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/phase10/symbolPerformanceRoute.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/autoTrading.js backend/src/__tests__/phase10/symbolPerformanceRoute.test.js
git commit -m "feat: engine dashboard per-symbol performance endpoint"
```

---

### Task 3: Backend `GET /auto-trading/calibration`

Confidence-vs-outcome reliability. Entry confidence for each closed position is the most recent `order_placed` run for that symbol at/before the position's `opened_at` (documented heuristic — positions have no hard run link).

**Files:**
- Modify: `backend/src/routes/autoTrading.js`
- Test: `backend/src/__tests__/phase10/calibrationRoute.test.js`

**Interfaces:**
- Produces: `GET /api/auto-trading/calibration` →
  ```json
  { "buckets": [ { "range": "70-80", "trades": 4, "win_rate": 0.75 } ], "total_closed": 12, "min_required": 10, "sufficient": true }
  ```
  Buckets are the fixed ranges `<50, 50-60, 60-70, 70-80, 80-90, 90-100`, only those with ≥1 trade included. `total_closed` counts closed positions that resolved a non-null entry confidence. `sufficient = total_closed >= min_required` (`min_required = 10`).

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase10/calibrationRoute.test.js`:

```js
const request = require('supertest');
const express = require('express');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

const autoTradingRouter = require('../../routes/autoTrading');
const app = express();
app.use(express.json());
app.use('/api/auto-trading', autoTradingRouter);

beforeEach(() => { jest.clearAllMocks(); mockDb.one.mockResolvedValue({ preferences: {} }); });

describe('GET /api/auto-trading/calibration', () => {
  test('buckets closed positions by entry confidence and computes win rate', async () => {
    mockDb.manyOrNone.mockResolvedValue([
      { pnl: '100', entry_confidence: '72' },
      { pnl: '50', entry_confidence: '75' },
      { pnl: '-20', entry_confidence: '78' },
      { pnl: '200', entry_confidence: '92' },
      { pnl: '10', entry_confidence: null },
    ]);
    const res = await request(app).get('/api/auto-trading/calibration');
    expect(res.status).toBe(200);
    const bucket70 = res.body.buckets.find((b) => b.range === '70-80');
    expect(bucket70).toEqual({ range: '70-80', trades: 3, win_rate: 2 / 3 });
    const bucket90 = res.body.buckets.find((b) => b.range === '90-100');
    expect(bucket90).toEqual({ range: '90-100', trades: 1, win_rate: 1 });
    expect(res.body.total_closed).toBe(4); // null entry_confidence excluded
    expect(res.body.min_required).toBe(10);
    expect(res.body.sufficient).toBe(false);
  });

  test('empty data returns no buckets and sufficient false', async () => {
    mockDb.manyOrNone.mockResolvedValue([]);
    const res = await request(app).get('/api/auto-trading/calibration');
    expect(res.body).toEqual({ buckets: [], total_closed: 0, min_required: 10, sufficient: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/phase10/calibrationRoute.test.js`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the handler**

Insert before `module.exports = router;` in `backend/src/routes/autoTrading.js`:

```js
// ── GET /api/auto-trading/calibration ─────────────────────────────────────────
// Entry confidence = most recent order_placed run for the symbol at/before open.

const CALIBRATION_MIN_REQUIRED = 10;
const CALIBRATION_BUCKETS = [
  { range: '<50', lo: -Infinity, hi: 50 },
  { range: '50-60', lo: 50, hi: 60 },
  { range: '60-70', lo: 60, hi: 70 },
  { range: '70-80', lo: 70, hi: 80 },
  { range: '80-90', lo: 80, hi: 90 },
  { range: '90-100', lo: 90, hi: Infinity },
];

router.get('/calibration', authenticate, asyncHandler(async (req, res) => {
  const rows = await db.manyOrNone(
    `SELECT p.pnl,
        (SELECT r.confidence FROM auto_trading_runs r
           WHERE r.user_id = p.user_id AND r.symbol = p.symbol AND r.action = 'order_placed'
             AND r.confidence IS NOT NULL AND r.created_at <= p.opened_at
           ORDER BY r.created_at DESC LIMIT 1) AS entry_confidence
       FROM positions p WHERE p.user_id = $1 AND p.status = 'closed'`, [req.user.id]);

  const scored = rows.filter((r) => r.entry_confidence != null)
    .map((r) => ({ conf: parseFloat(r.entry_confidence), win: parseFloat(r.pnl) > 0 }));

  const buckets = CALIBRATION_BUCKETS.map((b) => {
    const inBucket = scored.filter((s) => s.conf >= b.lo && s.conf < b.hi);
    return { range: b.range, trades: inBucket.length, win_rate: inBucket.length > 0 ? inBucket.filter((s) => s.win).length / inBucket.length : 0 };
  }).filter((b) => b.trades > 0);

  res.json({
    buckets,
    total_closed: scored.length,
    min_required: CALIBRATION_MIN_REQUIRED,
    sufficient: scored.length >= CALIBRATION_MIN_REQUIRED,
  });
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/phase10/calibrationRoute.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/autoTrading.js backend/src/__tests__/phase10/calibrationRoute.test.js
git commit -m "feat: engine dashboard confidence-calibration endpoint"
```

---

### Task 4: Backend `GET /auto-trading/guardrail-trips`

Groups cycles where the engine analyzed but code declined to act, by reason (`action LIKE 'skipped_%'`).

**Files:**
- Modify: `backend/src/routes/autoTrading.js`
- Test: `backend/src/__tests__/phase10/guardrailTripsRoute.test.js`

**Interfaces:**
- Produces: `GET /api/auto-trading/guardrail-trips` →
  ```json
  { "trips": [ { "action": "skipped_low_confidence", "count": 24 }, { "action": "skipped_existing_position", "count": 13 } ], "total_runs": 140, "min_required": 20, "sufficient": true }
  ```
  `sufficient = total_runs >= min_required` (`min_required = 20`).

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase10/guardrailTripsRoute.test.js`:

```js
const request = require('supertest');
const express = require('express');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

const autoTradingRouter = require('../../routes/autoTrading');
const app = express();
app.use(express.json());
app.use('/api/auto-trading', autoTradingRouter);

beforeEach(() => { jest.clearAllMocks(); mockDb.one.mockResolvedValue({ preferences: {} }); });

describe('GET /api/auto-trading/guardrail-trips', () => {
  test('returns skip-reason counts and sufficiency', async () => {
    mockDb.one.mockResolvedValue({ count: '140' });
    mockDb.manyOrNone.mockResolvedValue([
      { action: 'skipped_low_confidence', count: 24 },
      { action: 'skipped_existing_position', count: 13 },
    ]);
    const res = await request(app).get('/api/auto-trading/guardrail-trips');
    expect(res.status).toBe(200);
    expect(res.body.trips).toEqual([
      { action: 'skipped_low_confidence', count: 24 },
      { action: 'skipped_existing_position', count: 13 },
    ]);
    expect(res.body.total_runs).toBe(140);
    expect(res.body.min_required).toBe(20);
    expect(res.body.sufficient).toBe(true);
  });

  test('sufficient false below threshold', async () => {
    mockDb.one.mockResolvedValue({ count: '5' });
    mockDb.manyOrNone.mockResolvedValue([]);
    const res = await request(app).get('/api/auto-trading/guardrail-trips');
    expect(res.body.sufficient).toBe(false);
    expect(res.body.trips).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/phase10/guardrailTripsRoute.test.js`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the handler**

Insert before `module.exports = router;` in `backend/src/routes/autoTrading.js`:

```js
// ── GET /api/auto-trading/guardrail-trips ─────────────────────────────────────

const GUARDRAIL_MIN_REQUIRED = 20;

router.get('/guardrail-trips', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const trips = await db.manyOrNone(
    `SELECT action, COUNT(*)::int AS count FROM auto_trading_runs
       WHERE user_id = $1 AND action LIKE 'skipped_%' GROUP BY action ORDER BY count DESC`, [userId]);
  const total = await db.one(`SELECT COUNT(*) FROM auto_trading_runs WHERE user_id = $1`, [userId]);
  const totalRuns = parseInt(total.count, 10);
  res.json({ trips, total_runs: totalRuns, min_required: GUARDRAIL_MIN_REQUIRED, sufficient: totalRuns >= GUARDRAIL_MIN_REQUIRED });
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/phase10/guardrailTripsRoute.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/autoTrading.js backend/src/__tests__/phase10/guardrailTripsRoute.test.js
git commit -m "feat: engine dashboard guardrail-trip analytics endpoint"
```

---

### Task 5: Backend — add filters to `GET /auto-trading/activity`

**Files:**
- Modify: `backend/src/routes/autoTrading.js` (existing `/activity` handler)
- Test: `backend/src/__tests__/phase10/activityFilters.test.js`

**Interfaces:**
- Consumes/Produces: same `{ runs, total, limit, offset }` shape, now accepting optional query params `symbol` (string), `action` (string), `from` (ISO date), `to` (ISO date). Filters are ANDed; unknown/absent params are ignored. Backward compatible.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase10/activityFilters.test.js`:

```js
const request = require('supertest');
const express = require('express');

const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));

const autoTradingRouter = require('../../routes/autoTrading');
const app = express();
app.use(express.json());
app.use('/api/auto-trading', autoTradingRouter);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.manyOrNone.mockResolvedValue([]);
  mockDb.one.mockResolvedValue({ count: '0' });
});

describe('GET /api/auto-trading/activity filters', () => {
  test('passes symbol and action into the WHERE clause and params', async () => {
    await request(app).get('/api/auto-trading/activity?symbol=NVDA&action=order_placed');
    const [listSql, listParams] = mockDb.manyOrNone.mock.calls[0];
    expect(listSql).toContain('symbol =');
    expect(listSql).toContain('action =');
    expect(listParams).toContain('NVDA');
    expect(listParams).toContain('order_placed');
  });

  test('passes from/to date bounds', async () => {
    await request(app).get('/api/auto-trading/activity?from=2026-07-01&to=2026-07-14');
    const [listSql, listParams] = mockDb.manyOrNone.mock.calls[0];
    expect(listSql).toContain('created_at >=');
    expect(listSql).toContain('created_at <=');
    expect(listParams).toContain('2026-07-01');
    expect(listParams).toContain('2026-07-14');
  });

  test('still works with no filters', async () => {
    const res = await request(app).get('/api/auto-trading/activity');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], total: 0, limit: 50, offset: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/phase10/activityFilters.test.js`
Expected: FAIL — SQL lacks `symbol =` / `created_at >=`.

- [ ] **Step 3: Replace the existing `/activity` handler**

In `backend/src/routes/autoTrading.js`, replace the whole existing `router.get('/activity', ...)` block with:

```js
router.get('/activity', authenticate, [
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
  query('symbol').optional().trim().toUpperCase().isLength({ min: 1, max: 20 }),
  query('action').optional().trim().isLength({ min: 1, max: 30 }),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { limit = 50, offset = 0, symbol, action, from, to } = req.query;

  const conditions = ['user_id = $1'];
  const params = [req.user.id];
  if (symbol) { params.push(symbol); conditions.push(`symbol = $${params.length}`); }
  if (action) { params.push(action); conditions.push(`action = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`created_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`created_at <= $${params.length}`); }
  const where = conditions.join(' AND ');

  const listParams = [...params, parseInt(limit), parseInt(offset)];
  const runs = await db.manyOrNone(
    `SELECT id, symbol, timeframe, decision, confidence, action, signal_id, order_id, reasoning, error_message, action_detail, created_at
       FROM auto_trading_runs WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, listParams);
  const { count } = await db.one(`SELECT COUNT(*) FROM auto_trading_runs WHERE ${where}`, params);

  res.json({ runs, total: parseInt(count), limit: parseInt(limit), offset: parseInt(offset) });
}));
```

- [ ] **Step 4: Run test to verify it passes, plus the existing v2 route tests**

Run: `cd backend && npx jest src/__tests__/phase10/activityFilters.test.js src/__tests__/phase8/autoTradingRoutesV2.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/autoTrading.js backend/src/__tests__/phase10/activityFilters.test.js
git commit -m "feat: symbol/action/date filters on auto-trading activity endpoint"
```

---

### Task 6: Frontend — types, route, nav, shared metrics hook, page scaffold + Health strip

Delivers a navigable `/auto-trading/dashboard` page showing the health strip.

**Files:**
- Modify: `frontend/src/types/api.ts` (append new interfaces)
- Create: `frontend/src/hooks/useEngineMetrics.ts`
- Create: `frontend/src/components/engine/HealthStrip.tsx`
- Create: `frontend/src/pages/trading/EngineDashboardPage.tsx`
- Modify: `frontend/src/router.tsx` (import + route)
- Modify: `frontend/src/components/layout/AppLayout.tsx` (nav entry)
- Test: `frontend/src/components/engine/HealthStrip.test.tsx`

**Interfaces:**
- Produces (types, used by all later frontend tasks):
  ```ts
  export interface EngineMetrics {
    health: { enabled: boolean; last_run_at: string | null; errors_24h: number; circuit_breaker_threshold: number; trades_today: number }
    performance: { return_pct: number | null; vs_buy_hold_pct: number | null; win_rate: number | null; trades: number }
    decision_breakdown: { action: string; count: number }[]
    avg_confidence: number | null
  }
  export interface EngineSymbolPerformanceRow {
    symbol: string; trades: number; win_rate: number | null; realized_pnl: number
    unrealized_pnl: number; avg_confidence: number | null; last_action: string | null; last_action_at: string | null
  }
  export interface EngineCalibration {
    buckets: { range: string; trades: number; win_rate: number }[]
    total_closed: number; min_required: number; sufficient: boolean
  }
  export interface EngineGuardrailTrips {
    trips: { action: string; count: number }[]
    total_runs: number; min_required: number; sufficient: boolean
  }
  ```
- Produces (hook): `useEngineMetrics(): UseQueryResult<EngineMetrics>` with query key `['engine-metrics']` — later tasks reuse this key so `/metrics` is fetched once.
- Produces (component): `HealthStrip` (no props; self-fetches via `useEngineMetrics`).

- [ ] **Step 1: Append types to `frontend/src/types/api.ts`**

Add the four interfaces above (`EngineMetrics`, `EngineSymbolPerformanceRow`, `EngineCalibration`, `EngineGuardrailTrips`) to the end of the file.

- [ ] **Step 2: Create the shared hook `frontend/src/hooks/useEngineMetrics.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { EngineMetrics } from '@/types/api'

export function useEngineMetrics() {
  return useQuery({
    queryKey: ['engine-metrics'],
    queryFn: async () => (await api.get<EngineMetrics>('/auto-trading/metrics')).data,
    refetchInterval: 60_000,
  })
}
```

- [ ] **Step 3: Write the failing HealthStrip test**

Create `frontend/src/components/engine/HealthStrip.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { HealthStrip } from './HealthStrip'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('HealthStrip', () => {
  test('renders status, errors vs threshold and trades today', async () => {
    ;(api.get as Mock).mockResolvedValue({
      data: {
        health: { enabled: true, last_run_at: '2026-07-14T12:00:00.000Z', errors_24h: 1, circuit_breaker_threshold: 5, trades_today: 2 },
        performance: { return_pct: null, vs_buy_hold_pct: null, win_rate: null, trades: 0 },
        decision_breakdown: [], avg_confidence: null,
      },
    })
    renderWithClient(<HealthStrip />)
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  test('shows disabled when engine is off', async () => {
    ;(api.get as Mock).mockResolvedValue({
      data: {
        health: { enabled: false, last_run_at: null, errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 0 },
        performance: { return_pct: null, vs_buy_hold_pct: null, win_rate: null, trades: 0 },
        decision_breakdown: [], avg_confidence: null,
      },
    })
    renderWithClient(<HealthStrip />)
    await waitFor(() => expect(screen.getByText('Disabled')).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/engine/HealthStrip.test.tsx`
Expected: FAIL — cannot resolve `./HealthStrip`.

- [ ] **Step 5: Implement `frontend/src/components/engine/HealthStrip.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { useEngineMetrics } from '@/hooks/useEngineMetrics'

export function HealthStrip() {
  const { data } = useEngineMetrics()
  const h = data?.health

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Tile label="Status" value={h ? (h.enabled ? 'Enabled' : 'Disabled') : '—'} tone={h?.enabled ? 'success' : undefined} />
      <Tile label="Last cycle" value={formatDate(h?.last_run_at)} />
      <Tile
        label="Errors 24h"
        value={h ? `${h.errors_24h} / ${h.circuit_breaker_threshold}` : '—'}
        tone={h && h.errors_24h >= h.circuit_breaker_threshold ? 'danger' : undefined}
      />
      <Tile label="Trades today" value={h ? h.trades_today : '—'} />
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: 'success' | 'danger' }) {
  return (
    <Card>
      <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
      <CardContent className={`text-2xl font-semibold ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>
        {value}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Create the page `frontend/src/pages/trading/EngineDashboardPage.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { HealthStrip } from '@/components/engine/HealthStrip'

export function EngineDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Engine dashboard</h1>
          <p className="text-sm text-muted">How the autonomous engine is performing and behaving. P&amp;L is attributed to the engine by symbol.</p>
        </div>
        <Link to="/auto-trading" className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground">
          Settings
        </Link>
      </div>
      <HealthStrip />
    </div>
  )
}
```

- [ ] **Step 7: Register the route in `frontend/src/router.tsx`**

Add the import next to the other trading-page imports:

```tsx
import { EngineDashboardPage } from '@/pages/trading/EngineDashboardPage'
```

Add the route inside the `AppLayout` children array, immediately after the `/auto-trading` route:

```tsx
          { path: '/auto-trading/dashboard', element: <EngineDashboardPage /> },
```

- [ ] **Step 8: Add the nav entry in `frontend/src/components/layout/AppLayout.tsx`**

Add `Activity` to the `lucide-react` import list, then add this item to `navItems` immediately after the `/auto-trading` entry:

```tsx
  { to: '/auto-trading/dashboard', label: 'Engine Dashboard', icon: Activity },
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/engine/HealthStrip.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/hooks/useEngineMetrics.ts frontend/src/components/engine/HealthStrip.tsx frontend/src/components/engine/HealthStrip.test.tsx frontend/src/pages/trading/EngineDashboardPage.tsx frontend/src/router.tsx frontend/src/components/layout/AppLayout.tsx
git commit -m "feat: engine dashboard page scaffold with health strip, route and nav"
```

---

### Task 7: Frontend — Performance panel

**Files:**
- Create: `frontend/src/components/engine/PerformancePanel.tsx`
- Modify: `frontend/src/pages/trading/EngineDashboardPage.tsx` (render it)
- Test: `frontend/src/components/engine/PerformancePanel.test.tsx`

**Interfaces:**
- Consumes: `useEngineMetrics` (KPIs) and `GET /auto-trading/benchmark` (`{ series: BenchmarkPoint[] }`) for the chart via `<BenchmarkChart>`.
- Produces: `PerformancePanel` (no props).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/engine/PerformancePanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { PerformancePanel } from './PerformancePanel'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))
vi.mock('@/components/BenchmarkChart', () => ({ BenchmarkChart: () => <div data-testid="benchmark-chart" /> }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const metrics = {
  health: { enabled: true, last_run_at: null, errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 0 },
  performance: { return_pct: 4.2, vs_buy_hold_pct: 1.1, win_rate: 0.61, trades: 18 },
  decision_breakdown: [], avg_confidence: null,
}

beforeEach(() => vi.clearAllMocks())

describe('PerformancePanel', () => {
  test('renders KPI tiles and the chart when 2+ snapshots exist', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/auto-trading/metrics') return Promise.resolve({ data: metrics })
      if (url === '/auto-trading/benchmark') return Promise.resolve({ data: { series: [
        { date: '2026-07-13', engine_equity: 100000, watchlist_value: 100000 },
        { date: '2026-07-14', engine_equity: 104200, watchlist_value: 103100 },
      ] } })
      return Promise.resolve({ data: {} })
    })
    renderWithClient(<PerformancePanel />)
    expect(await screen.findByText('4.20%')).toBeInTheDocument() // return_pct
    expect(screen.getByText('61.0%')).toBeInTheDocument() // win_rate
    expect(screen.getByText('18')).toBeInTheDocument() // trades
    expect(screen.getByTestId('benchmark-chart')).toBeInTheDocument()
  })

  test('shows the pending-snapshot note with fewer than 2 snapshots', async () => {
    ;(api.get as Mock).mockImplementation((url: string) => {
      if (url === '/auto-trading/metrics') return Promise.resolve({ data: { ...metrics, performance: { ...metrics.performance, return_pct: null, vs_buy_hold_pct: null } } })
      if (url === '/auto-trading/benchmark') return Promise.resolve({ data: { series: [] } })
      return Promise.resolve({ data: {} })
    })
    renderWithClient(<PerformancePanel />)
    expect(await screen.findByText(/appears after the second daily snapshot/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/engine/PerformancePanel.test.tsx`
Expected: FAIL — cannot resolve `./PerformancePanel`.

- [ ] **Step 3: Implement `frontend/src/components/engine/PerformancePanel.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BenchmarkChart } from '@/components/BenchmarkChart'
import { api } from '@/lib/api'
import { formatPercent } from '@/lib/format'
import { useEngineMetrics } from '@/hooks/useEngineMetrics'
import type { BenchmarkPoint } from '@/types/api'

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`)

export function PerformancePanel() {
  const { data: metrics } = useEngineMetrics()
  const benchmarkQuery = useQuery({
    queryKey: ['engine-benchmark'],
    queryFn: async () => (await api.get<{ series: BenchmarkPoint[] }>('/auto-trading/benchmark')).data.series,
  })
  const p = metrics?.performance
  const series = benchmarkQuery.data ?? []

  return (
    <Card>
      <CardHeader><CardTitle>Performance vs buy-and-hold</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Return" value={pct(p?.return_pct ?? null)} tone={p && p.return_pct != null && p.return_pct >= 0 ? 'success' : 'danger'} />
          <Kpi label="vs buy-and-hold" value={pct(p?.vs_buy_hold_pct ?? null)} tone={p && p.vs_buy_hold_pct != null && p.vs_buy_hold_pct >= 0 ? 'success' : 'danger'} />
          <Kpi label="Win rate" value={p?.win_rate != null ? formatPercent(p.win_rate) : '—'} />
          <Kpi label="Trades" value={p ? String(p.trades) : '—'} />
        </div>
        {series.length > 1 ? (
          <BenchmarkChart series={series} />
        ) : (
          <p className="text-sm text-muted">The engine-vs-buy-and-hold chart appears after the second daily snapshot.</p>
        )}
      </CardContent>
    </Card>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>{value}</div>
    </div>
  )
}
```

- [ ] **Step 4: Render it in the page**

In `frontend/src/pages/trading/EngineDashboardPage.tsx`, add the import and render `<PerformancePanel />` immediately after `<HealthStrip />`:

```tsx
import { PerformancePanel } from '@/components/engine/PerformancePanel'
```
```tsx
      <HealthStrip />
      <PerformancePanel />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/engine/PerformancePanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/engine/PerformancePanel.tsx frontend/src/components/engine/PerformancePanel.test.tsx frontend/src/pages/trading/EngineDashboardPage.tsx
git commit -m "feat: engine dashboard performance-vs-benchmark panel"
```

---

### Task 8: Frontend — Decision breakdown panel

**Files:**
- Create: `frontend/src/components/engine/DecisionBreakdownPanel.tsx`
- Modify: `frontend/src/pages/trading/EngineDashboardPage.tsx`
- Test: `frontend/src/components/engine/DecisionBreakdownPanel.test.tsx`

**Interfaces:**
- Consumes: `useEngineMetrics` (`decision_breakdown`, `avg_confidence`).
- Produces: `DecisionBreakdownPanel` (no props). Renders one horizontal bar per action, width proportional to the max count, plus an average-confidence line.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/engine/DecisionBreakdownPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { DecisionBreakdownPanel } from './DecisionBreakdownPanel'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('DecisionBreakdownPanel', () => {
  test('renders a labelled bar per action and the average confidence', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: {
      health: { enabled: true, last_run_at: null, errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 0 },
      performance: { return_pct: null, vs_buy_hold_pct: null, win_rate: null, trades: 0 },
      decision_breakdown: [ { action: 'order_placed', count: 12 }, { action: 'skipped_low_confidence', count: 30 } ],
      avg_confidence: 64.5,
    } })
    renderWithClient(<DecisionBreakdownPanel />)
    expect(await screen.findByText('order_placed')).toBeInTheDocument()
    expect(screen.getByText('skipped_low_confidence')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText(/Avg confidence/)).toHaveTextContent('65%')
  })

  test('shows an empty state when there are no runs', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: {
      health: { enabled: false, last_run_at: null, errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 0 },
      performance: { return_pct: null, vs_buy_hold_pct: null, win_rate: null, trades: 0 },
      decision_breakdown: [], avg_confidence: null,
    } })
    renderWithClient(<DecisionBreakdownPanel />)
    expect(await screen.findByText('No decisions recorded yet.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/engine/DecisionBreakdownPanel.test.tsx`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `frontend/src/components/engine/DecisionBreakdownPanel.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { useEngineMetrics } from '@/hooks/useEngineMetrics'

export function DecisionBreakdownPanel() {
  const { data } = useEngineMetrics()
  const rows = data?.decision_breakdown ?? []
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0)

  return (
    <Card>
      <CardHeader><CardTitle>Decision breakdown</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 && <p className="text-sm text-muted">No decisions recorded yet.</p>}
        {rows.map((r) => (
          <div key={r.action} className="flex items-center gap-3 text-sm">
            <span className="w-44 shrink-0 text-right text-muted">{r.action}</span>
            <span className="h-2.5 rounded bg-primary" style={{ width: `${max > 0 ? (r.count / max) * 100 : 0}%` }} />
            <span className="w-10 text-foreground">{r.count}</span>
          </div>
        ))}
        {data?.avg_confidence != null && (
          <p className="text-xs text-muted">Avg confidence across decisions: {formatNumber(data.avg_confidence, 0)}%</p>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Render it in the page**

In `EngineDashboardPage.tsx`, add the import and render after `<PerformancePanel />`:

```tsx
import { DecisionBreakdownPanel } from '@/components/engine/DecisionBreakdownPanel'
```
```tsx
      <PerformancePanel />
      <DecisionBreakdownPanel />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/engine/DecisionBreakdownPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/engine/DecisionBreakdownPanel.tsx frontend/src/components/engine/DecisionBreakdownPanel.test.tsx frontend/src/pages/trading/EngineDashboardPage.tsx
git commit -m "feat: engine dashboard decision-breakdown panel"
```

---

### Task 9: Frontend — Per-symbol performance table

**Files:**
- Create: `frontend/src/components/engine/SymbolPerformanceTable.tsx`
- Modify: `frontend/src/pages/trading/EngineDashboardPage.tsx`
- Test: `frontend/src/components/engine/SymbolPerformanceTable.test.tsx`

**Interfaces:**
- Consumes: `GET /auto-trading/symbol-performance` → `{ symbols: EngineSymbolPerformanceRow[] }`.
- Produces: `SymbolPerformanceTable` (no props).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/engine/SymbolPerformanceTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { SymbolPerformanceTable } from './SymbolPerformanceTable'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('SymbolPerformanceTable', () => {
  test('renders a row per symbol with realized and unrealized P&L', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { symbols: [
      { symbol: 'NVDA', trades: 7, win_rate: 0.71, realized_pnl: 412, unrealized_pnl: 120, avg_confidence: 68, last_action: 'order_placed', last_action_at: '2026-07-14T12:00:00.000Z' },
      { symbol: 'AAPL', trades: 4, win_rate: 0.5, realized_pnl: -83, unrealized_pnl: 0, avg_confidence: 59, last_action: 'skipped_low_confidence', last_action_at: '2026-07-14T12:05:00.000Z' },
    ] } })
    renderWithClient(<SymbolPerformanceTable />)
    expect(await screen.findByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('$412.00')).toBeInTheDocument()
    expect(screen.getByText('$120.00')).toBeInTheDocument()
    expect(screen.getByText('-$83.00')).toBeInTheDocument()
    expect(screen.getByText('71.0%')).toBeInTheDocument()
  })

  test('shows an empty state when there is no per-symbol data', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { symbols: [] } })
    renderWithClient(<SymbolPerformanceTable />)
    expect(await screen.findByText('No per-symbol activity yet.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/engine/SymbolPerformanceTable.test.tsx`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `frontend/src/components/engine/SymbolPerformanceTable.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format'
import type { EngineSymbolPerformanceRow } from '@/types/api'

export function SymbolPerformanceTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['engine-symbol-performance'],
    queryFn: async () => (await api.get<{ symbols: EngineSymbolPerformanceRow[] }>('/auto-trading/symbol-performance')).data.symbols,
  })
  const rows = data ?? []

  return (
    <Card>
      <CardHeader><CardTitle>Per-symbol performance</CardTitle></CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!isLoading && rows.length === 0 && <p className="text-sm text-muted">No per-symbol activity yet.</p>}
        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Trades</TableHead>
                <TableHead>Win %</TableHead>
                <TableHead>Realized P&amp;L</TableHead>
                <TableHead>Unrealized P&amp;L</TableHead>
                <TableHead>Avg conf</TableHead>
                <TableHead>Last action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.symbol}>
                  <TableCell className="font-medium text-foreground">{r.symbol}</TableCell>
                  <TableCell>{r.trades}</TableCell>
                  <TableCell>{r.win_rate != null ? formatPercent(r.win_rate) : '—'}</TableCell>
                  <TableCell className={r.realized_pnl >= 0 ? 'text-success' : 'text-danger'}>{formatCurrency(r.realized_pnl)}</TableCell>
                  <TableCell className={r.unrealized_pnl >= 0 ? 'text-success' : 'text-danger'}>{formatCurrency(r.unrealized_pnl)}</TableCell>
                  <TableCell>{r.avg_confidence != null ? `${formatNumber(r.avg_confidence, 0)}%` : '—'}</TableCell>
                  <TableCell className="text-muted">{r.last_action ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Render it in the page**

In `EngineDashboardPage.tsx`, add the import and render after `<DecisionBreakdownPanel />`:

```tsx
import { SymbolPerformanceTable } from '@/components/engine/SymbolPerformanceTable'
```
```tsx
      <DecisionBreakdownPanel />
      <SymbolPerformanceTable />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/engine/SymbolPerformanceTable.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/engine/SymbolPerformanceTable.tsx frontend/src/components/engine/SymbolPerformanceTable.test.tsx frontend/src/pages/trading/EngineDashboardPage.tsx
git commit -m "feat: engine dashboard per-symbol performance table"
```

---

### Task 10: Frontend — Activity feed with filters + drill-down

**Files:**
- Create: `frontend/src/components/engine/ActivityFeed.tsx`
- Modify: `frontend/src/pages/trading/EngineDashboardPage.tsx`
- Test: `frontend/src/components/engine/ActivityFeed.test.tsx`

**Interfaces:**
- Consumes: `GET /auto-trading/activity` with optional `symbol` / `action` params (Task 5) → `{ runs: AutoTradingRun[]; total: number }`.
- Produces: `ActivityFeed` (no props). Symbol text filter + action `<Select>`; clicking a row toggles an expanded detail region showing `action_detail` (timeframe alignment badges, execution JSON, reasoning/error).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/engine/ActivityFeed.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { ActivityFeed } from './ActivityFeed'
import { api } from '@/lib/api'
import type { AutoTradingRun } from '@/types/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const run: AutoTradingRun = {
  id: 'r1', symbol: 'NVDA', timeframe: '15m+1h+4h', decision: 'buy', confidence: 72,
  action: 'order_placed', signal_id: null, order_id: 'o1', reasoning: 'Momentum aligned', error_message: null,
  action_detail: { decision: { timeframe_alignment: { '1h': 'bullish', '4h': 'bullish' } } }, created_at: '2026-07-14T12:00:00.000Z',
}

beforeEach(() => vi.clearAllMocks())

describe('ActivityFeed', () => {
  test('renders rows and expands a row to show detail on click', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { runs: [run], total: 1 } })
    renderWithClient(<ActivityFeed />)
    const row = await screen.findByText('NVDA')
    // detail hidden initially
    expect(screen.queryByText('1h bullish')).not.toBeInTheDocument()
    fireEvent.click(row)
    expect(await screen.findByText('1h bullish')).toBeInTheDocument()
    expect(screen.getByText('Momentum aligned')).toBeInTheDocument()
  })

  test('typing a symbol filter refetches with the symbol param', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { runs: [run], total: 1 } })
    renderWithClient(<ActivityFeed />)
    await screen.findByText('NVDA')
    fireEvent.change(screen.getByPlaceholderText('Filter symbol'), { target: { value: 'AAPL' } })
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/auto-trading/activity', expect.objectContaining({ params: expect.objectContaining({ symbol: 'AAPL' }) })),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/engine/ActivityFeed.test.tsx`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `frontend/src/components/engine/ActivityFeed.tsx`**

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatDate, formatNumber, signalBadgeVariant } from '@/lib/format'
import type { AutoTradingRun } from '@/types/api'

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'order_placed', label: 'order_placed' },
  { value: 'position_closed', label: 'position_closed' },
  { value: 'partial_exit', label: 'partial_exit' },
  { value: 'stop_adjusted', label: 'stop_adjusted' },
  { value: 'skipped_low_confidence', label: 'skipped_low_confidence' },
  { value: 'skipped_existing_position', label: 'skipped_existing_position' },
  { value: 'error', label: 'error' },
]

export function ActivityFeed() {
  const [symbol, setSymbol] = useState('')
  const [action, setAction] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const params: Record<string, string | number> = { limit: 50 }
  if (symbol.trim()) params.symbol = symbol.trim().toUpperCase()
  if (action) params.action = action

  const { data, isLoading } = useQuery({
    queryKey: ['engine-activity', params.symbol ?? '', params.action ?? ''],
    queryFn: async () => (await api.get<{ runs: AutoTradingRun[]; total: number }>('/auto-trading/activity', { params })).data,
    refetchInterval: 60_000,
  })
  const runs = data?.runs ?? []

  return (
    <Card>
      <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Filter symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-40" />
          <Select value={action} onValueChange={setAction} options={ACTION_OPTIONS} placeholder="All actions" />
        </div>
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!isLoading && runs.length === 0 && <p className="text-sm text-muted">No matching activity.</p>}
        {runs.length > 0 && (
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <>
                  <TableRow key={run.id} onClick={() => setExpanded(expanded === run.id ? null : run.id)} className="cursor-pointer">
                    <TableCell className="text-muted">{formatDate(run.created_at)}</TableCell>
                    <TableCell className="font-medium text-foreground">{run.symbol}</TableCell>
                    <TableCell>{run.decision ? <Badge variant={signalBadgeVariant(run.decision)}>{run.decision}</Badge> : '—'}</TableCell>
                    <TableCell>{run.confidence != null ? `${formatNumber(run.confidence, 0)}%` : '—'}</TableCell>
                    <TableCell><Badge variant="muted">{run.action}</Badge></TableCell>
                  </TableRow>
                  {expanded === run.id && (
                    <TableRow key={`${run.id}-detail`}>
                      <TableCell colSpan={5} className="bg-card/40">
                        <div className="flex flex-col gap-2 p-2 text-sm">
                          <p className="text-muted">{run.reasoning || run.error_message || 'No reasoning recorded.'}</p>
                          {run.action_detail?.decision?.timeframe_alignment && (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(run.action_detail.decision.timeframe_alignment).map(([tf, bias]) => (
                                <Badge key={tf} variant={bias === 'bullish' ? 'success' : bias === 'bearish' ? 'danger' : 'muted'}>{tf} {bias}</Badge>
                              ))}
                            </div>
                          )}
                          {run.action_detail?.execution && (
                            <pre className="overflow-x-auto rounded bg-background p-2 text-xs text-muted">{JSON.stringify(run.action_detail.execution, null, 2)}</pre>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Render it in the page**

In `EngineDashboardPage.tsx`, add the import and render after `<SymbolPerformanceTable />`:

```tsx
import { ActivityFeed } from '@/components/engine/ActivityFeed'
```
```tsx
      <SymbolPerformanceTable />
      <ActivityFeed />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/engine/ActivityFeed.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/engine/ActivityFeed.tsx frontend/src/components/engine/ActivityFeed.test.tsx frontend/src/pages/trading/EngineDashboardPage.tsx
git commit -m "feat: engine dashboard activity feed with filters and drill-down"
```

---

### Task 11: Frontend — Confidence calibration panel

**Files:**
- Create: `frontend/src/components/engine/CalibrationPanel.tsx`
- Modify: `frontend/src/pages/trading/EngineDashboardPage.tsx`
- Test: `frontend/src/components/engine/CalibrationPanel.test.tsx`

**Interfaces:**
- Consumes: `GET /auto-trading/calibration` → `EngineCalibration`.
- Produces: `CalibrationPanel` (no props). When `sufficient` is false, renders the "needs N closed trades" message instead of the chart.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/engine/CalibrationPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { CalibrationPanel } from './CalibrationPanel'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('CalibrationPanel', () => {
  test('renders bucket rows when there is enough data', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: {
      buckets: [ { range: '70-80', trades: 6, win_rate: 0.67 }, { range: '80-90', trades: 5, win_rate: 0.8 } ],
      total_closed: 11, min_required: 10, sufficient: true,
    } })
    renderWithClient(<CalibrationPanel />)
    expect(await screen.findByText('70-80')).toBeInTheDocument()
    expect(screen.getByText('67.0%')).toBeInTheDocument()
    expect(screen.getByText('80-90')).toBeInTheDocument()
  })

  test('shows insufficient-data message below the threshold', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { buckets: [], total_closed: 3, min_required: 10, sufficient: false } })
    renderWithClient(<CalibrationPanel />)
    expect(await screen.findByText(/needs at least 10 closed trades/i)).toBeInTheDocument()
    expect(screen.getByText(/3 so far/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/engine/CalibrationPanel.test.tsx`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `frontend/src/components/engine/CalibrationPanel.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatPercent } from '@/lib/format'
import type { EngineCalibration } from '@/types/api'

export function CalibrationPanel() {
  const { data } = useQuery({
    queryKey: ['engine-calibration'],
    queryFn: async () => (await api.get<EngineCalibration>('/auto-trading/calibration')).data,
  })

  return (
    <Card>
      <CardHeader><CardTitle>Confidence calibration</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted">Does stated confidence match actual win rate? Entry confidence matched to each closed trade by the most recent order.</p>
        {!data?.sufficient && (
          <p className="text-sm text-muted">
            Calibration needs at least {data?.min_required ?? 10} closed trades to be meaningful ({data?.total_closed ?? 0} so far).
          </p>
        )}
        {data?.sufficient && data.buckets.map((b) => (
          <div key={b.range} className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0 text-muted">{b.range}</span>
            <span className="h-2.5 rounded bg-primary" style={{ width: `${b.win_rate * 100}%` }} />
            <span className="w-14 text-foreground">{formatPercent(b.win_rate)}</span>
            <span className="text-xs text-muted">({b.trades})</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Render it in the page**

In `EngineDashboardPage.tsx`, add the import and render after `<ActivityFeed />`:

```tsx
import { CalibrationPanel } from '@/components/engine/CalibrationPanel'
```
```tsx
      <ActivityFeed />
      <CalibrationPanel />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/engine/CalibrationPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/engine/CalibrationPanel.tsx frontend/src/components/engine/CalibrationPanel.test.tsx frontend/src/pages/trading/EngineDashboardPage.tsx
git commit -m "feat: engine dashboard confidence-calibration panel"
```

---

### Task 12: Frontend — Guardrail-trip analytics panel

**Files:**
- Create: `frontend/src/components/engine/GuardrailTripsPanel.tsx`
- Modify: `frontend/src/pages/trading/EngineDashboardPage.tsx`
- Test: `frontend/src/components/engine/GuardrailTripsPanel.test.tsx`

**Interfaces:**
- Consumes: `GET /auto-trading/guardrail-trips` → `EngineGuardrailTrips`.
- Produces: `GuardrailTripsPanel` (no props). Below-threshold → insufficient message; otherwise one row per skip reason with count.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/engine/GuardrailTripsPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { GuardrailTripsPanel } from './GuardrailTripsPanel'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('GuardrailTripsPanel', () => {
  test('lists skip reasons with counts when sufficient', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: {
      trips: [ { action: 'skipped_low_confidence', count: 24 }, { action: 'skipped_existing_position', count: 13 } ],
      total_runs: 140, min_required: 20, sufficient: true,
    } })
    renderWithClient(<GuardrailTripsPanel />)
    expect(await screen.findByText('skipped_low_confidence')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('skipped_existing_position')).toBeInTheDocument()
  })

  test('shows insufficient message below threshold', async () => {
    ;(api.get as Mock).mockResolvedValue({ data: { trips: [], total_runs: 5, min_required: 20, sufficient: false } })
    renderWithClient(<GuardrailTripsPanel />)
    expect(await screen.findByText(/needs at least 20 cycles/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/engine/GuardrailTripsPanel.test.tsx`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `frontend/src/components/engine/GuardrailTripsPanel.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import type { EngineGuardrailTrips } from '@/types/api'

export function GuardrailTripsPanel() {
  const { data } = useQuery({
    queryKey: ['engine-guardrail-trips'],
    queryFn: async () => (await api.get<EngineGuardrailTrips>('/auto-trading/guardrail-trips')).data,
  })
  const max = (data?.trips ?? []).reduce((m, t) => Math.max(m, t.count), 0)

  return (
    <Card>
      <CardHeader><CardTitle>Guardrail trips</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted">Cycles where the engine analyzed but code declined to act, by reason. The safety layer at work.</p>
        {!data?.sufficient && (
          <p className="text-sm text-muted">Needs at least {data?.min_required ?? 20} cycles to be meaningful ({data?.total_runs ?? 0} so far).</p>
        )}
        {data?.sufficient && data.trips.map((t) => (
          <div key={t.action} className="flex items-center gap-3 text-sm">
            <span className="w-56 shrink-0 text-right text-muted">{t.action}</span>
            <span className="h-2.5 rounded bg-primary" style={{ width: `${max > 0 ? (t.count / max) * 100 : 0}%` }} />
            <span className="w-10 text-foreground">{t.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Render it in the page**

In `EngineDashboardPage.tsx`, add the import and render after `<CalibrationPanel />`:

```tsx
import { GuardrailTripsPanel } from '@/components/engine/GuardrailTripsPanel'
```
```tsx
      <CalibrationPanel />
      <GuardrailTripsPanel />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/engine/GuardrailTripsPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/engine/GuardrailTripsPanel.tsx frontend/src/components/engine/GuardrailTripsPanel.test.tsx frontend/src/pages/trading/EngineDashboardPage.tsx
git commit -m "feat: engine dashboard guardrail-trip analytics panel"
```

---

### Task 13: Frontend — config↔dashboard cross-link + page integration test + full suite

**Files:**
- Modify: `frontend/src/pages/trading/AutoTradingPage.tsx` (add a "View dashboard" link)
- Test: `frontend/src/pages/trading/EngineDashboardPage.test.tsx`

**Interfaces:**
- Consumes: all panels and endpoints from Tasks 6–12.
- Produces: nothing new; verifies the composed page.

- [ ] **Step 1: Write the failing integration test**

Create `frontend/src/pages/trading/EngineDashboardPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { EngineDashboardPage } from './EngineDashboardPage'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))
vi.mock('@/components/BenchmarkChart', () => ({ BenchmarkChart: () => <div data-testid="benchmark-chart" /> }))

const metrics = {
  health: { enabled: true, last_run_at: '2026-07-14T12:00:00.000Z', errors_24h: 0, circuit_breaker_threshold: 5, trades_today: 2 },
  performance: { return_pct: 4.2, vs_buy_hold_pct: 1.1, win_rate: 0.61, trades: 18 },
  decision_breakdown: [{ action: 'order_placed', count: 12 }], avg_confidence: 64.5,
}

function mockGet() {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/auto-trading/metrics') return Promise.resolve({ data: metrics })
    if (url === '/auto-trading/benchmark') return Promise.resolve({ data: { series: [] } })
    if (url === '/auto-trading/symbol-performance') return Promise.resolve({ data: { symbols: [] } })
    if (url === '/auto-trading/activity') return Promise.resolve({ data: { runs: [], total: 0 } })
    if (url === '/auto-trading/calibration') return Promise.resolve({ data: { buckets: [], total_closed: 0, min_required: 10, sufficient: false } })
    if (url === '/auto-trading/guardrail-trips') return Promise.resolve({ data: { trips: [], total_runs: 0, min_required: 20, sufficient: false } })
    return Promise.resolve({ data: {} })
  })
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><EngineDashboardPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.clearAllMocks(); mockGet() })

describe('EngineDashboardPage', () => {
  test('renders all seven panels', async () => {
    renderPage()
    expect(await screen.findByText('Engine dashboard')).toBeInTheDocument()
    expect(screen.getByText('Trades today')).toBeInTheDocument() // health strip
    expect(await screen.findByText('Performance vs buy-and-hold')).toBeInTheDocument()
    expect(screen.getByText('Decision breakdown')).toBeInTheDocument()
    expect(screen.getByText('Per-symbol performance')).toBeInTheDocument()
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('Confidence calibration')).toBeInTheDocument()
    expect(screen.getByText('Guardrail trips')).toBeInTheDocument()
  })

  test('has a link back to engine settings', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'Settings' })
    expect(link).toHaveAttribute('href', '/auto-trading')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/trading/EngineDashboardPage.test.tsx`
Expected: FAIL if any panel title text differs; if the page already composes all panels it may pass. Fix any mismatched titles in the panel components before continuing.

- [ ] **Step 3: Add the "View dashboard" link on the config page**

In `frontend/src/pages/trading/AutoTradingPage.tsx`, import `Link` and add a link in the header block. Change the top `<div>` header:

```tsx
import { Link } from 'react-router-dom'
```

Replace the header block (the `<div>` wrapping the `<h1>Auto Trading</h1>`):

```tsx
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Auto Trading</h1>
          <p className="text-sm text-muted">
            Let SignalPro continuously analyze your watchlist and place trades automatically through your connected broker.
          </p>
        </div>
        <Link to="/auto-trading/dashboard" className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground">
          View dashboard
        </Link>
      </div>
```

- [ ] **Step 4: Run the full engine test suite**

Run: `cd frontend && npx vitest run src/components/engine src/pages/trading/EngineDashboardPage.test.tsx src/pages/trading/AutoTradingPage.test.tsx`
Expected: PASS (all engine component tests + page + unchanged config-page tests).

Run: `cd backend && npx jest src/__tests__/phase10`
Expected: PASS (all five backend endpoint test files).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/trading/AutoTradingPage.tsx frontend/src/pages/trading/EngineDashboardPage.test.tsx
git commit -m "feat: engine dashboard cross-link and full-page integration test"
```

---

## Verification

After Task 13, run the whole affected suites and a typecheck/lint:

```bash
cd backend && npx jest src/__tests__/phase10
cd frontend && npx vitest run src/components/engine src/pages/trading
cd frontend && npx tsc --noEmit
```

Then drive the page in the app (per the `verify`/`run` skill): navigate to `/auto-trading/dashboard`, confirm the health strip, KPIs, and panels render, that the activity filter changes results, and that a row expands to its decision detail.

## Notes for the implementer

- **`<>` fragment keys in Task 10:** the row + its detail row are wrapped in a fragment inside `.map`. React warns about keys on fragments; if lint flags it, convert the fragment to `<React.Fragment key={run.id}>…</React.Fragment>` and drop the inner `key` props.
- **`Select` API:** the existing `Select` primitive takes `value`, `onValueChange`, `options` ({value,label}), and `placeholder` (see `AutoTradingPage.tsx`). Do not swap in a native `<select>`.
- **Do not modify** the existing `/status`, `/benchmark`, `/settings` endpoints or the config page's existing panels beyond the header link.
