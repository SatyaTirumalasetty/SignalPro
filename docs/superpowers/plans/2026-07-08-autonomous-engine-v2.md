# Autonomous Trading Engine v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the v1 auto-trading engine into a fused multi-timeframe decision engine that autonomously opens AND manages/closes positions, with user-selectable AI cost modes, authority toggles, and benchmark-vs-buy-and-hold tracking.

**Architecture:** Structured decision pipeline (spec: `docs/superpowers/specs/2026-07-08-autonomous-engine-v2-design.md`). Deterministic Node orchestrator assembles per-symbol multi-timeframe context, makes ONE Claude call returning a structured decision (`open_long|open_short|close|adjust_stop|partial_exit|add|hold`), then deterministic guardrails gate and execute it. Claude proposes; code disposes.

**Tech Stack:** Node 18+ CommonJS backend (Express, pg-promise, node-cron, @anthropic-ai/sdk, Jest with mocked deps), React 18 + TypeScript frontend (Vite, @tanstack/react-query, Tailwind v4, lightweight-charts v5, Vitest + testing-library).

## Global Constraints

- Branch: `engine-v2` (already created off master; spec committed as `02d4e0e`).
- Backend is CommonJS (`require`/`module.exports`), flat `backend/src/services/` layout — follow it.
- All backend tests mock the DB (`pg-promise` style `db.one/oneOrNone/manyOrNone/none`), Anthropic client, and broker adapters. **No test may hit a real broker or the Anthropic API.**
- Backend tests live in `backend/src/__tests__/phase8/`. Run with `cd backend && npx jest src/__tests__/phase8 --coverage=false`.
- Frontend tests: `cd frontend && npx vitest run src/pages/trading/AutoTradingPage.test.tsx`.
- Model IDs come from env, never hardcoded at call sites: `ANTHROPIC_MODEL_SMALL` (default `claude-haiku-4-5-20251001`), `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`), `ANTHROPIC_MODEL_TOP` (default `claude-opus-4-8`).
- Default AI mode is `balanced`. Default authority: `{ close: true, adjust_stop: false, partial_exit: false, add: false }`. Stops may only tighten, never widen.
- Fail closed for entries, fail safe for exits: when guardrail inputs can't be evaluated, block `open_long`/`open_short`/`add` but still execute `close`.
- Existing v1 behaviors kept: 15-min cron `7,22,37,52 * * * *`, circuit breaker at 5 consecutive errors, `AUTO_TRADING_ENABLED` env kill switch, per-user enable, cooldown, max trades/day, daily loss limit.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`), committed after each task.
- Alpaca is the only broker with autonomous capabilities in v2; every other adapter must degrade to `skipped_unsupported_broker`, never a silent no-op.

---

### Task 1: Database migration

**Files:**
- Create: `backend/database/migrations/20260708000000_engine_v2.sql`

**Interfaces:**
- Produces: `auto_trading_runs.action_detail` (JSONB), widened `decision`/`timeframe` columns, and table `benchmark_snapshots(user_id, snapshot_date, engine_equity, watchlist_value, watchlist_composition)` with `UNIQUE (user_id, snapshot_date)`. Tasks 9, 10, 11 rely on these.

- [ ] **Step 1: Write the migration**

```sql
-- Engine v2: fused multi-timeframe decisions with position management.
-- action_detail stores the full decision JSON + guardrail/execution detail.
-- decision/timeframe widened: values like 'partial_exit' (12) and
-- '15m+1h+4h+1d' (12) exceed the v1 VARCHAR(10).

ALTER TABLE auto_trading_runs ADD COLUMN IF NOT EXISTS action_detail JSONB;
ALTER TABLE auto_trading_runs ALTER COLUMN decision TYPE VARCHAR(20);
ALTER TABLE auto_trading_runs ALTER COLUMN timeframe TYPE VARCHAR(20);

-- Daily benchmark: engine equity vs an equal-weight buy-and-hold of the
-- watchlist frozen at first snapshot (composition = {symbol: qty}).
CREATE TABLE IF NOT EXISTS benchmark_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  engine_equity NUMERIC(14,2) NOT NULL,
  watchlist_value NUMERIC(14,2) NOT NULL,
  watchlist_composition JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_snapshots_user_date
  ON benchmark_snapshots(user_id, snapshot_date DESC);
```

- [ ] **Step 2: Verify it applies cleanly**

The migration runner (`backend/src/database/migrate.js`, npm script `migrate`) currently lives on the `deploy-pipeline` branch, not `engine-v2`. Verify by applying the SQL directly to the local docker postgres (data volume port 5433):

Run: `docker compose exec -T postgres psql -U signalpro -d signalpro < backend/database/migrations/20260708000000_engine_v2.sql`
Expected: `ALTER TABLE` ×3, `CREATE TABLE`, `CREATE INDEX` with no errors. (If the postgres container isn't running: `docker compose up -d postgres` first. If the compose service/user names differ, check `docker-compose.yml` at repo root.)

- [ ] **Step 3: Commit**

```bash
git add backend/database/migrations/20260708000000_engine_v2.sql
git commit -m "feat: engine v2 migration - action_detail, benchmark_snapshots"
```

---

### Task 2: Decision schema validation

**Files:**
- Create: `backend/src/services/decisionSchema.js`
- Test: `backend/src/__tests__/phase8/decisionSchema.test.js`

**Interfaces:**
- Produces:
  - `VALID_ACTIONS: string[]` — `['open_long','open_short','close','adjust_stop','partial_exit','add','hold']`
  - `ENTRY_ACTIONS: string[]` — `['open_long','open_short','add']`
  - `POSITION_ACTIONS: string[]` — `['close','adjust_stop','partial_exit','add']`
  - `validateDecision(raw, { hasPosition }) → { ok: true, decision } | { ok: false, errors: string[] }` — `decision` is the normalized object (confidence clamped to integer 0–100, missing optional fields defaulted to `null`).

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase8/decisionSchema.test.js
const {
  validateDecision, VALID_ACTIONS, ENTRY_ACTIONS, POSITION_ACTIONS,
} = require('../../services/decisionSchema');

const openLong = {
  action: 'open_long', confidence: 80, reasoning: 'trend up',
  timeframe_alignment: { '1h': 'bullish' },
  entry_price: 100, stop_loss: 95, take_profit: 110,
  exit_fraction: null, risk_reward: 2, invalidation: 'close below 95',
};

describe('validateDecision', () => {
  test('accepts a valid open_long without a position', () => {
    const res = validateDecision(openLong, { hasPosition: false });
    expect(res.ok).toBe(true);
    expect(res.decision.action).toBe('open_long');
    expect(res.decision.confidence).toBe(80);
  });

  test('rejects unknown action', () => {
    const res = validateDecision({ ...openLong, action: 'yolo' }, { hasPosition: false });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/action/);
  });

  test('rejects position actions without an open position', () => {
    for (const action of POSITION_ACTIONS) {
      const res = validateDecision({ ...openLong, action, exit_fraction: 0.5 }, { hasPosition: false });
      expect(res.ok).toBe(false);
    }
  });

  test('rejects open_long/open_short without stop_loss', () => {
    const res = validateDecision({ ...openLong, stop_loss: null }, { hasPosition: false });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/stop_loss/);
  });

  test('rejects partial_exit without exit_fraction in (0,1)', () => {
    for (const exit_fraction of [null, 0, 1, 1.5]) {
      const res = validateDecision(
        { ...openLong, action: 'partial_exit', exit_fraction }, { hasPosition: true }
      );
      expect(res.ok).toBe(false);
    }
    const ok = validateDecision(
      { ...openLong, action: 'partial_exit', exit_fraction: 0.5 }, { hasPosition: true }
    );
    expect(ok.ok).toBe(true);
  });

  test('rejects adjust_stop without stop_loss', () => {
    const res = validateDecision(
      { ...openLong, action: 'adjust_stop', stop_loss: null }, { hasPosition: true }
    );
    expect(res.ok).toBe(false);
  });

  test('clamps confidence to integer 0-100 and defaults optionals to null', () => {
    const res = validateDecision(
      { action: 'hold', confidence: 150.7, reasoning: 'r' }, { hasPosition: false }
    );
    expect(res.ok).toBe(true);
    expect(res.decision.confidence).toBe(100);
    expect(res.decision.entry_price).toBeNull();
    expect(res.decision.invalidation).toBeNull();
  });

  test('exports action constants', () => {
    expect(VALID_ACTIONS).toContain('hold');
    expect(ENTRY_ACTIONS).toEqual(['open_long', 'open_short', 'add']);
    expect(POSITION_ACTIONS).toEqual(['close', 'adjust_stop', 'partial_exit', 'add']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/decisionSchema.test.js --coverage=false`
Expected: FAIL — `Cannot find module '../../services/decisionSchema'`

- [ ] **Step 3: Implement**

```js
// backend/src/services/decisionSchema.js
// Validates the structured decision JSON returned by Claude before the
// engine acts on it. Never guess a trade from a malformed response.

const VALID_ACTIONS = ['open_long', 'open_short', 'close', 'adjust_stop', 'partial_exit', 'add', 'hold'];
const ENTRY_ACTIONS = ['open_long', 'open_short', 'add'];
const POSITION_ACTIONS = ['close', 'adjust_stop', 'partial_exit', 'add'];

const NUMERIC_FIELDS = ['entry_price', 'stop_loss', 'take_profit', 'exit_fraction', 'risk_reward'];

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validateDecision(raw, { hasPosition }) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['decision is not an object'] };

  if (!VALID_ACTIONS.includes(raw.action)) errors.push(`invalid action: ${raw.action}`);

  if (POSITION_ACTIONS.includes(raw.action) && !hasPosition) {
    errors.push(`${raw.action} requires an open position`);
  }

  const decision = {
    action: raw.action,
    confidence: Math.min(100, Math.max(0, Math.round(Number(raw.confidence) || 0))),
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    timeframe_alignment: raw.timeframe_alignment && typeof raw.timeframe_alignment === 'object'
      ? raw.timeframe_alignment : {},
    invalidation: typeof raw.invalidation === 'string' ? raw.invalidation : null,
  };
  for (const f of NUMERIC_FIELDS) decision[f] = num(raw[f]);

  if (['open_long', 'open_short', 'add'].includes(raw.action) && decision.stop_loss === null) {
    errors.push(`${raw.action} requires stop_loss`);
  }
  if (raw.action === 'adjust_stop' && decision.stop_loss === null) {
    errors.push('adjust_stop requires stop_loss');
  }
  if (raw.action === 'partial_exit'
      && (decision.exit_fraction === null || decision.exit_fraction <= 0 || decision.exit_fraction >= 1)) {
    errors.push('partial_exit requires exit_fraction strictly between 0 and 1');
  }

  return errors.length ? { ok: false, errors } : { ok: true, decision };
}

module.exports = { VALID_ACTIONS, ENTRY_ACTIONS, POSITION_ACTIONS, validateDecision };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/phase8/decisionSchema.test.js --coverage=false`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/decisionSchema.js backend/src/__tests__/phase8/decisionSchema.test.js
git commit -m "feat: decision schema validation for engine v2"
```

---

### Task 3: AI modes

**Files:**
- Create: `backend/src/services/aiModes.js`
- Modify: `backend/.env.example` (around lines 50–52, the ANTHROPIC block)
- Test: `backend/src/__tests__/phase8/aiModes.test.js`

**Interfaces:**
- Produces: `resolveAiMode(name) → { name, screeningModel: string|null, decisionModel: string, maxTokens: number, thinkingBudget: number|null, contextProfile: 'trimmed'|'full' }`. Unknown/missing names fall back to `balanced`. `AI_MODE_NAMES: string[]` for route validation (Task 10).

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase8/aiModes.test.js
describe('resolveAiMode', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_MODEL_SMALL;
    delete process.env.ANTHROPIC_MODEL_TOP;
  });

  function load() {
    return require('../../services/aiModes');
  }

  test('balanced is the default and uses the decision model, full context, no thinking', () => {
    const { resolveAiMode } = load();
    for (const input of ['balanced', undefined, 'nonsense']) {
      const mode = resolveAiMode(input);
      expect(mode.name).toBe('balanced');
      expect(mode.decisionModel).toBe('claude-sonnet-4-6');
      expect(mode.screeningModel).toBeNull();
      expect(mode.thinkingBudget).toBeNull();
      expect(mode.contextProfile).toBe('full');
    }
  });

  test('minimize uses the small model with trimmed context', () => {
    const mode = load().resolveAiMode('minimize');
    expect(mode.decisionModel).toBe('claude-haiku-4-5-20251001');
    expect(mode.contextProfile).toBe('trimmed');
    expect(mode.screeningModel).toBeNull();
  });

  test('tiered screens with the small model and decides with the decision model', () => {
    const mode = load().resolveAiMode('tiered');
    expect(mode.screeningModel).toBe('claude-haiku-4-5-20251001');
    expect(mode.decisionModel).toBe('claude-sonnet-4-6');
  });

  test('max uses the top model with extended thinking and maxTokens above the budget', () => {
    const mode = load().resolveAiMode('max');
    expect(mode.decisionModel).toBe('claude-opus-4-8');
    expect(mode.thinkingBudget).toBe(4096);
    expect(mode.maxTokens).toBeGreaterThan(mode.thinkingBudget);
  });

  test('model ids come from env', () => {
    process.env.ANTHROPIC_MODEL = 'custom-decision';
    process.env.ANTHROPIC_MODEL_SMALL = 'custom-small';
    process.env.ANTHROPIC_MODEL_TOP = 'custom-top';
    const { resolveAiMode } = load();
    expect(resolveAiMode('balanced').decisionModel).toBe('custom-decision');
    expect(resolveAiMode('minimize').decisionModel).toBe('custom-small');
    expect(resolveAiMode('max').decisionModel).toBe('custom-top');
  });

  test('AI_MODE_NAMES lists all four modes', () => {
    expect(load().AI_MODE_NAMES).toEqual(['minimize', 'balanced', 'tiered', 'max']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/aiModes.test.js --coverage=false`
Expected: FAIL — `Cannot find module '../../services/aiModes'`

- [ ] **Step 3: Implement**

```js
// backend/src/services/aiModes.js
// User-selectable AI cost/intelligence posture for the autonomous engine.
// Model ids come from env so upgrades never require a code change.

function models() {
  return {
    small: process.env.ANTHROPIC_MODEL_SMALL || 'claude-haiku-4-5-20251001',
    decision: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    top: process.env.ANTHROPIC_MODEL_TOP || 'claude-opus-4-8',
  };
}

const AI_MODE_NAMES = ['minimize', 'balanced', 'tiered', 'max'];

function resolveAiMode(name) {
  const m = models();
  const modes = {
    minimize: { screeningModel: null, decisionModel: m.small, maxTokens: 1024, thinkingBudget: null, contextProfile: 'trimmed' },
    balanced: { screeningModel: null, decisionModel: m.decision, maxTokens: 1500, thinkingBudget: null, contextProfile: 'full' },
    tiered: { screeningModel: m.small, decisionModel: m.decision, maxTokens: 1500, thinkingBudget: null, contextProfile: 'full' },
    max: { screeningModel: null, decisionModel: m.top, maxTokens: 8192, thinkingBudget: 4096, contextProfile: 'full' },
  };
  const key = AI_MODE_NAMES.includes(name) ? name : 'balanced';
  return { name: key, ...modes[key] };
}

module.exports = { resolveAiMode, AI_MODE_NAMES };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/phase8/aiModes.test.js --coverage=false`
Expected: PASS (6 tests)

- [ ] **Step 5: Add the new env vars to `backend/.env.example`**

Find the existing block (around line 50):

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-sonnet-4-5
ANTHROPIC_MAX_TOKENS=1000
```

Replace with:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
# Decision model for balanced/tiered auto-trading modes and manual signals
ANTHROPIC_MODEL=claude-sonnet-4-6
# Screening + minimize-mode model
ANTHROPIC_MODEL_SMALL=claude-haiku-4-5-20251001
# Max-mode model (extended thinking)
ANTHROPIC_MODEL_TOP=claude-opus-4-8
ANTHROPIC_MAX_TOKENS=1000
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/aiModes.js backend/src/__tests__/phase8/aiModes.test.js backend/.env.example
git commit -m "feat: AI mode resolver (minimize/balanced/tiered/max)"
```

---

### Task 4: Risk management extensions

**Files:**
- Modify: `backend/src/services/riskManagement.js`
- Test: `backend/src/__tests__/phase8/riskManagementV2.test.js`

**Interfaces:**
- Consumes: existing `calculatePositionSize`, `checkDailyLossLimit` (unchanged).
- Produces:
  - `DEFAULT_AUTHORITY = { close: true, adjust_stop: false, partial_exit: false, add: false }`
  - `checkAuthority(authority, action) → boolean` — actions not in the authority map (entries, hold) return `true`; they're governed by `enabled`, not toggles.
  - `validateStopAdjustment({ positionType, currentStop, newStop }) → boolean` — tighten-only. Long: `newStop > currentStop`; short: `newStop < currentStop`; no current stop → `true` (setting one is always safer).
  - `partialExitQuantity({ positionQty, exitFraction }) → number` — `floor(qty × fraction)`, 0 when inputs invalid.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase8/riskManagementV2.test.js
const {
  DEFAULT_AUTHORITY, checkAuthority, validateStopAdjustment, partialExitQuantity,
} = require('../../services/riskManagement');

describe('checkAuthority', () => {
  test('defaults: close allowed, others denied', () => {
    expect(checkAuthority(DEFAULT_AUTHORITY, 'close')).toBe(true);
    expect(checkAuthority(DEFAULT_AUTHORITY, 'adjust_stop')).toBe(false);
    expect(checkAuthority(DEFAULT_AUTHORITY, 'partial_exit')).toBe(false);
    expect(checkAuthority(DEFAULT_AUTHORITY, 'add')).toBe(false);
  });

  test('entries and hold are not governed by authority toggles', () => {
    expect(checkAuthority(DEFAULT_AUTHORITY, 'open_long')).toBe(true);
    expect(checkAuthority(DEFAULT_AUTHORITY, 'hold')).toBe(true);
  });

  test('user-enabled toggle allows the action', () => {
    expect(checkAuthority({ ...DEFAULT_AUTHORITY, adjust_stop: true }, 'adjust_stop')).toBe(true);
  });
});

describe('validateStopAdjustment', () => {
  test('long: only a higher stop is a tighten', () => {
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: 97 })).toBe(true);
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: 93 })).toBe(false);
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: 95 })).toBe(false);
  });

  test('short: only a lower stop is a tighten', () => {
    expect(validateStopAdjustment({ positionType: 'short', currentStop: 105, newStop: 103 })).toBe(true);
    expect(validateStopAdjustment({ positionType: 'short', currentStop: 105, newStop: 107 })).toBe(false);
  });

  test('no current stop: setting one is allowed', () => {
    expect(validateStopAdjustment({ positionType: 'long', currentStop: null, newStop: 90 })).toBe(true);
  });

  test('invalid newStop rejected', () => {
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: 0 })).toBe(false);
    expect(validateStopAdjustment({ positionType: 'long', currentStop: 95, newStop: null })).toBe(false);
  });
});

describe('partialExitQuantity', () => {
  test('floors to whole shares', () => {
    expect(partialExitQuantity({ positionQty: 10, exitFraction: 0.5 })).toBe(5);
    expect(partialExitQuantity({ positionQty: 7, exitFraction: 0.5 })).toBe(3);
  });

  test('returns 0 for invalid inputs or fractions outside (0,1)', () => {
    expect(partialExitQuantity({ positionQty: 1, exitFraction: 0.5 })).toBe(0);
    expect(partialExitQuantity({ positionQty: 10, exitFraction: 0 })).toBe(0);
    expect(partialExitQuantity({ positionQty: 10, exitFraction: 1 })).toBe(0);
    expect(partialExitQuantity({ positionQty: 0, exitFraction: 0.5 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/riskManagementV2.test.js --coverage=false`
Expected: FAIL — `checkAuthority is not a function`

- [ ] **Step 3: Implement (append to `backend/src/services/riskManagement.js` before `module.exports`, and extend the exports)**

```js
// ── Engine v2: authority + position-management guardrails ────────────────────

// Which position-management actions the engine may take autonomously.
// Entries and hold are governed by the master `enabled` flag, not by these.
const DEFAULT_AUTHORITY = { close: true, adjust_stop: false, partial_exit: false, add: false };

function checkAuthority(authority = DEFAULT_AUTHORITY, action) {
  if (action in DEFAULT_AUTHORITY) return authority?.[action] === true;
  return true;
}

// Stops may only tighten: higher for longs, lower for shorts. No current
// stop means setting one is always the safer direction.
function validateStopAdjustment({ positionType, currentStop, newStop }) {
  if (!newStop || newStop <= 0) return false;
  if (currentStop == null) return true;
  return positionType === 'long' ? newStop > currentStop : newStop < currentStop;
}

// Whole-share partial exit; 0 means "can't size safely, skip".
function partialExitQuantity({ positionQty, exitFraction }) {
  if (!positionQty || !exitFraction || exitFraction <= 0 || exitFraction >= 1) return 0;
  return Math.floor(positionQty * exitFraction);
}
```

And change the exports at the bottom to:

```js
module.exports = {
  calculatePositionSize,
  checkDailyLossLimit,
  DEFAULT_RISK_PER_TRADE_PCT,
  DEFAULT_MAX_DAILY_LOSS_PCT,
  DEFAULT_AUTHORITY,
  checkAuthority,
  validateStopAdjustment,
  partialExitQuantity,
};
```

Note: `partialExitQuantity({ positionQty: 1, exitFraction: 0.5 })` = `floor(0.5)` = 0 — the test above relies on this (a 1-share position can't partially exit).

- [ ] **Step 4: Run tests to verify they pass — including the existing v1 risk tests**

Run: `cd backend && npx jest riskManagement --coverage=false`
Expected: PASS (new file + any existing risk tests still green)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/riskManagement.js backend/src/__tests__/phase8/riskManagementV2.test.js
git commit -m "feat: authority + stop-tighten + partial-exit guardrails"
```

---

### Task 5: Broker adapter capabilities (base + Alpaca)

**Files:**
- Modify: `backend/src/services/brokers/adapters/base.js`
- Modify: `backend/src/services/brokers/adapters/alpaca.js`
- Test: `backend/src/__tests__/phase8/alpacaAutonomous.test.js`

**Interfaces:**
- Produces (base defaults, overridden by Alpaca):
  - `capabilities() → string[]` — base returns `[]`; Alpaca returns `['place_order','cancel_order','close_position','replace_order','open_orders']`.
  - `getOpenOrders(symbol) → [{ broker_order_id, symbol, side, order_type, quantity, stop_price, limit_price, status }]`
  - `closePosition(symbol, quantity = null) → { order_id, status, message }` — omitted quantity closes the whole position.
  - `replaceOrder(brokerOrderId, { stop_price, limit_price, quantity }) → { order_id, status, message }`
  - Base versions of the three methods throw `this.apiError('<broker> does not support autonomous trading', 501)`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase8/alpacaAutonomous.test.js
const axios = require('axios');
jest.mock('axios');

const AlpacaAdapter = require('../../services/brokers/adapters/alpaca');
const BaseAdapter = require('../../services/brokers/adapters/base');

const http = { get: jest.fn(), post: jest.fn(), delete: jest.fn(), patch: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  axios.create.mockReturnValue(http);
});

function adapter() {
  return new AlpacaAdapter({ api_key: 'k', api_secret: 's', paper: true });
}

describe('capabilities', () => {
  test('base adapter has none', () => {
    expect(new BaseAdapter('other', {}).capabilities()).toEqual([]);
  });

  test('alpaca supports autonomous trading', () => {
    expect(adapter().capabilities()).toEqual(
      expect.arrayContaining(['place_order', 'cancel_order', 'close_position', 'replace_order', 'open_orders'])
    );
  });

  test('base autonomous methods throw not-supported', async () => {
    const base = new BaseAdapter('other', {});
    await expect(base.closePosition('AAPL')).rejects.toThrow(/does not support/);
    await expect(base.getOpenOrders('AAPL')).rejects.toThrow(/does not support/);
    await expect(base.replaceOrder('id', {})).rejects.toThrow(/does not support/);
  });
});

describe('alpaca getOpenOrders', () => {
  test('maps open orders including stop_price', async () => {
    http.get.mockResolvedValue({
      data: [{ id: 'o1', symbol: 'AAPL', side: 'sell', type: 'stop', qty: '10', stop_price: '95.5', limit_price: null, status: 'new' }],
    });
    const orders = await adapter().getOpenOrders('AAPL');
    expect(http.get).toHaveBeenCalledWith('/v2/orders', { params: { status: 'open', symbols: 'AAPL' } });
    expect(orders).toEqual([{
      broker_order_id: 'o1', symbol: 'AAPL', side: 'sell', order_type: 'stop',
      quantity: 10, stop_price: 95.5, limit_price: null, status: 'pending',
    }]);
  });
});

describe('alpaca closePosition', () => {
  test('closes whole position via DELETE /v2/positions/:symbol', async () => {
    http.delete.mockResolvedValue({ data: { id: 'close-1', status: 'accepted' } });
    const res = await adapter().closePosition('AAPL');
    expect(http.delete).toHaveBeenCalledWith('/v2/positions/AAPL', { params: {} });
    expect(res.order_id).toBe('close-1');
  });

  test('passes qty for partial close', async () => {
    http.delete.mockResolvedValue({ data: { id: 'close-2', status: 'accepted' } });
    await adapter().closePosition('AAPL', 5);
    expect(http.delete).toHaveBeenCalledWith('/v2/positions/AAPL', { params: { qty: '5' } });
  });

  test('wraps API errors', async () => {
    http.delete.mockRejectedValue({ response: { data: { message: 'position not found' }, status: 404 } });
    await expect(adapter().closePosition('AAPL')).rejects.toThrow(/position not found/);
  });
});

describe('alpaca replaceOrder', () => {
  test('patches stop_price', async () => {
    http.patch.mockResolvedValue({ data: { id: 'o2', status: 'replaced' } });
    const res = await adapter().replaceOrder('o1', { stop_price: 97 });
    expect(http.patch).toHaveBeenCalledWith('/v2/orders/o1', { stop_price: '97' });
    expect(res.order_id).toBe('o2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/alpacaAutonomous.test.js --coverage=false`
Expected: FAIL — `capabilities is not a function`

- [ ] **Step 3: Implement base defaults**

Add to the `BaseAdapter` class in `backend/src/services/brokers/adapters/base.js` (after the existing `cancelOrder` method; reuse the class's existing broker-id field — check the constructor, it's the first constructor argument):

```js
  // Autonomous-trading capabilities. Brokers that can't do these degrade to
  // skipped_unsupported_broker in the engine — never a silent no-op.
  capabilities() {
    return [];
  }

  async getOpenOrders(_symbol) {
    throw this.apiError(`${this.brokerId} does not support autonomous trading via SignalPro`, 501);
  }

  async closePosition(_symbol, _quantity = null) {
    throw this.apiError(`${this.brokerId} does not support autonomous trading via SignalPro`, 501);
  }

  async replaceOrder(_brokerOrderId, _changes = {}) {
    throw this.apiError(`${this.brokerId} does not support autonomous trading via SignalPro`, 501);
  }
```

If the constructor stores the id under a different name than `brokerId`, use that name.

- [ ] **Step 4: Implement Alpaca overrides**

Add to the `AlpacaAdapter` class in `backend/src/services/brokers/adapters/alpaca.js` (after `cancelOrder`):

```js
  capabilities() {
    return ['place_order', 'cancel_order', 'close_position', 'replace_order', 'open_orders'];
  }

  async getOpenOrders(symbol) {
    try {
      const { data } = await this.http.get('/v2/orders', { params: { status: 'open', symbols: symbol } });
      return data.map(o => ({
        broker_order_id: o.id,
        symbol: o.symbol,
        side: o.side,
        order_type: o.type,
        quantity: +o.qty,
        stop_price: o.stop_price ? +o.stop_price : null,
        limit_price: o.limit_price ? +o.limit_price : null,
        status: mapStatus(o.status),
      }));
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async closePosition(symbol, quantity = null) {
    try {
      const params = quantity ? { qty: String(quantity) } : {};
      const { data } = await this.http.delete(`/v2/positions/${encodeURIComponent(symbol)}`, { params });
      return { order_id: data.id, status: mapStatus(data.status), message: `Alpaca close order ${data.id} ${data.status}` };
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }

  async replaceOrder(brokerOrderId, { stop_price, limit_price, quantity } = {}) {
    const body = {};
    if (stop_price != null) body.stop_price = String(stop_price);
    if (limit_price != null) body.limit_price = String(limit_price);
    if (quantity != null) body.qty = String(quantity);
    try {
      const { data } = await this.http.patch(`/v2/orders/${brokerOrderId}`, body);
      return { order_id: data.id, status: mapStatus(data.status), message: `Alpaca order ${brokerOrderId} replaced by ${data.id}` };
    } catch (err) {
      throw this.apiError(`Alpaca: ${err.response?.data?.message || err.message}`, err.response?.status);
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass, plus existing adapter tests**

Run: `cd backend && npx jest src/__tests__/phase8/alpacaAutonomous.test.js --coverage=false && npx jest brokers --coverage=false`
Expected: PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/brokers/adapters/base.js backend/src/services/brokers/adapters/alpaca.js backend/src/__tests__/phase8/alpacaAutonomous.test.js
git commit -m "feat: alpaca close/replace/open-orders + adapter capabilities"
```

---

### Task 6: Market context assembly

**Files:**
- Create: `backend/src/services/marketContext.js`
- Test: `backend/src/__tests__/phase8/marketContext.test.js`

**Interfaces:**
- Consumes: `getHistoricalData(symbol, interval, bars)` from `./marketData` (returns `{ current_price, previous_close, candles }`), `calculateAll(candles)` from `./indicators`, `getNews(symbols, limit)` from `./alpacaMarketData`.
- Produces:
  - `buildMarketContext({ symbol, timeframes, contextProfile, position, portfolio }) → { symbol, current_price, previous_close, timeframes: { [tf]: { candles, indicators } }, news, position, portfolio }`. Throws `Error('No market data available for <symbol>')` when every timeframe comes back empty. Profile `trimmed`: first 2 timeframes, last 5 candles each, no news. Profile `full`: all timeframes (max 4), last 20 candles each, 5 news items.
  - `buildScreeningSummaries(symbols, positionsBySymbol) → { summaries: [{ symbol, current_price, change_pct, rsi_14, has_position }], unscreenable: string[] }` — symbols whose data fetch fails land in `unscreenable` (the engine analyzes them anyway; screening fails open).

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase8/marketContext.test.js
const mockGetHistoricalData = jest.fn();
const mockCalculateAll = jest.fn();
const mockGetNews = jest.fn();

jest.mock('../../services/marketData', () => ({ getHistoricalData: mockGetHistoricalData }));
jest.mock('../../services/indicators', () => ({ calculateAll: mockCalculateAll }));
jest.mock('../../services/alpacaMarketData', () => ({ getNews: mockGetNews }));

const { buildMarketContext, buildScreeningSummaries } = require('../../services/marketContext');

function candles(n) {
  return Array.from({ length: n }, (_, i) => ({
    time: `2026-07-08T0${i % 10}:00`, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHistoricalData.mockResolvedValue({ current_price: 150, previous_close: 148, candles: candles(50) });
  mockCalculateAll.mockReturnValue({ rsi_14: 55 });
  mockGetNews.mockResolvedValue([{ headline: 'h', source: 's', created_at: '2026-07-08' }]);
});

describe('buildMarketContext', () => {
  test('full profile: all timeframes, 20 candles each, news included', async () => {
    const ctx = await buildMarketContext({
      symbol: 'AAPL', timeframes: ['15m', '1h', '4h', '1d'], contextProfile: 'full',
      position: null, portfolio: { equity: 100000 },
    });
    expect(Object.keys(ctx.timeframes)).toEqual(['15m', '1h', '4h', '1d']);
    expect(ctx.timeframes['1h'].candles).toHaveLength(20);
    expect(ctx.timeframes['1h'].indicators).toEqual({ rsi_14: 55 });
    expect(ctx.news).toHaveLength(1);
    expect(ctx.current_price).toBe(150);
    expect(ctx.portfolio.equity).toBe(100000);
  });

  test('trimmed profile: first 2 timeframes, 5 candles, no news', async () => {
    const ctx = await buildMarketContext({
      symbol: 'AAPL', timeframes: ['15m', '1h', '4h', '1d'], contextProfile: 'trimmed',
    });
    expect(Object.keys(ctx.timeframes)).toEqual(['15m', '1h']);
    expect(ctx.timeframes['15m'].candles).toHaveLength(5);
    expect(ctx.news).toEqual([]);
    expect(mockGetNews).not.toHaveBeenCalled();
  });

  test('throws when no timeframe has data', async () => {
    mockGetHistoricalData.mockResolvedValue({ current_price: null, previous_close: null, candles: [] });
    await expect(buildMarketContext({ symbol: 'XX', timeframes: ['1h'] }))
      .rejects.toThrow(/No market data available for XX/);
  });

  test('news failure is non-fatal', async () => {
    mockGetNews.mockRejectedValue(new Error('news down'));
    const ctx = await buildMarketContext({ symbol: 'AAPL', timeframes: ['1h'], contextProfile: 'full' });
    expect(ctx.news).toEqual([]);
  });
});

describe('buildScreeningSummaries', () => {
  test('summarizes symbols and flags positions', async () => {
    const { summaries, unscreenable } = await buildScreeningSummaries(
      ['AAPL', 'MSFT'], new Map([['MSFT', { symbol: 'MSFT' }]])
    );
    expect(unscreenable).toEqual([]);
    expect(summaries).toEqual([
      { symbol: 'AAPL', current_price: 150, change_pct: 1.35, rsi_14: 55, has_position: false },
      { symbol: 'MSFT', current_price: 150, change_pct: 1.35, rsi_14: 55, has_position: true },
    ]);
  });

  test('fetch failures land in unscreenable', async () => {
    mockGetHistoricalData
      .mockResolvedValueOnce({ current_price: 150, previous_close: 148, candles: candles(50) })
      .mockRejectedValueOnce(new Error('feed down'));
    const { summaries, unscreenable } = await buildScreeningSummaries(['AAPL', 'BAD'], new Map());
    expect(summaries.map((s) => s.symbol)).toEqual(['AAPL']);
    expect(unscreenable).toEqual(['BAD']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/marketContext.test.js --coverage=false`
Expected: FAIL — `Cannot find module '../../services/marketContext'`

- [ ] **Step 3: Implement**

```js
// backend/src/services/marketContext.js
// Assembles the fused multi-timeframe context the decision prompt is built
// from. One context per symbol per cycle; indicators computed on the full
// fetched history, candles trimmed for the prompt.

const { getHistoricalData } = require('./marketData');
const { calculateAll } = require('./indicators');
const { getNews } = require('./alpacaMarketData');

const PROFILES = {
  trimmed: { maxTimeframes: 2, bars: 100, promptCandles: 5, newsItems: 0 },
  full: { maxTimeframes: 4, bars: 250, promptCandles: 20, newsItems: 5 },
};

async function buildMarketContext({ symbol, timeframes, contextProfile = 'full', position = null, portfolio = null }) {
  const profile = PROFILES[contextProfile] || PROFILES.full;
  const tfs = timeframes.slice(0, profile.maxTimeframes);

  const tfData = {};
  let current_price = null;
  let previous_close = null;
  for (const tf of tfs) {
    const hist = await getHistoricalData(symbol, tf, profile.bars);
    if (!hist.candles.length) continue;
    tfData[tf] = {
      candles: hist.candles.slice(-profile.promptCandles),
      indicators: calculateAll(hist.candles),
    };
    current_price = hist.current_price;
    previous_close = hist.previous_close;
  }
  if (!Object.keys(tfData).length) {
    throw new Error(`No market data available for ${symbol}`);
  }

  const news = profile.newsItems
    ? await getNews([symbol], profile.newsItems).catch(() => [])
    : [];

  return { symbol, current_price, previous_close, timeframes: tfData, news, position, portfolio };
}

// Lightweight per-symbol summary for the tiered-mode screening pass.
// Screening fails open: symbols we can't summarize are analyzed anyway.
async function buildScreeningSummaries(symbols, positionsBySymbol) {
  const summaries = [];
  const unscreenable = [];
  for (const symbol of symbols) {
    try {
      const hist = await getHistoricalData(symbol, '1h', 50);
      if (!hist.candles.length) throw new Error('no data');
      const indicators = calculateAll(hist.candles);
      summaries.push({
        symbol,
        current_price: hist.current_price,
        change_pct: +(((hist.current_price - hist.previous_close) / hist.previous_close) * 100).toFixed(2),
        rsi_14: indicators.rsi_14 ?? null,
        has_position: positionsBySymbol.has(symbol),
      });
    } catch {
      unscreenable.push(symbol);
    }
  }
  return { summaries, unscreenable };
}

module.exports = { buildMarketContext, buildScreeningSummaries };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/phase8/marketContext.test.js --coverage=false`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/marketContext.js backend/src/__tests__/phase8/marketContext.test.js
git commit -m "feat: fused multi-timeframe market context assembly"
```

---

### Task 7: Decision generation + screening (aiAnalysis v2)

**Files:**
- Modify: `backend/src/services/aiAnalysis.js` (add code; `generateSignal` stays untouched for the manual path)
- Test: `backend/src/__tests__/phase8/generateDecision.test.js`

**Interfaces:**
- Consumes: `validateDecision` (Task 2), mode object from `resolveAiMode` (Task 3), context from `buildMarketContext` (Task 6).
- Produces:
  - `generateDecision(userId, context, mode) → decision` — validated/normalized decision plus `{ id: <historical_signals uuid | null>, ai_model, ai_tokens_used }`. Persists a `historical_signals` row only for `open_long`/`open_short` (mapped to `buy`/`sell` so SignalPerformancePage keeps working). Retries ONCE on malformed/invalid JSON, then throws `502`.
  - `screenSymbols(summaries, mode) → string[]` — symbols worth deep analysis, per one small-model call. Throws on API/parse error (engine treats a throw as "analyze everything").

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase8/generateDecision.test.js
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockCreate },
})));

const mockDb = { one: jest.fn(), none: jest.fn() };
jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn() }));

const { generateDecision, screenSymbols } = require('../../services/aiAnalysis');

const MODE = {
  name: 'balanced', screeningModel: null, decisionModel: 'model-x',
  maxTokens: 1500, thinkingBudget: null, contextProfile: 'full',
};

const CONTEXT = {
  symbol: 'AAPL', current_price: 150, previous_close: 148,
  timeframes: { '1h': { candles: [{ time: '2026-07-08T10:00', open: 149, high: 151, low: 148, close: 150, volume: 1 }], indicators: { rsi_14: 55 } } },
  news: [], position: null, portfolio: { equity: 100000, open_positions: 0, exposure_pct: 0, todays_realized_pnl: 0 },
};

function claudeText(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 100, output_tokens: 50 } };
}

const GOOD = {
  action: 'open_long', confidence: 82, reasoning: 'aligned', timeframe_alignment: { '1h': 'bullish' },
  entry_price: 150, stop_loss: 145, take_profit: 160, exit_fraction: null, risk_reward: 2, invalidation: 'close < 145',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockDb.one.mockResolvedValue({ id: 'sig-1', created_at: '2026-07-08' });
  mockDb.none.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue(claudeText(GOOD));
});

describe('generateDecision', () => {
  test('returns validated decision and persists a signal row for entries', async () => {
    const d = await generateDecision('user-1', CONTEXT, MODE);
    expect(d.action).toBe('open_long');
    expect(d.id).toBe('sig-1');
    expect(d.ai_model).toBe('model-x');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-x', max_tokens: 1500 }));
    expect(mockDb.one).toHaveBeenCalledWith(expect.stringContaining('historical_signals'), expect.any(Array));
  });

  test('does not persist a signal row for hold/close', async () => {
    mockCreate.mockResolvedValue(claudeText({ action: 'hold', confidence: 40, reasoning: 'chop' }));
    const d = await generateDecision('user-1', CONTEXT, MODE);
    expect(d.action).toBe('hold');
    expect(d.id).toBeNull();
    expect(mockDb.one).not.toHaveBeenCalled();
  });

  test('retries once on malformed JSON, then succeeds', async () => {
    mockCreate
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }], usage: {} })
      .mockResolvedValueOnce(claudeText(GOOD));
    const d = await generateDecision('user-1', CONTEXT, MODE);
    expect(d.action).toBe('open_long');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('throws 502 after two invalid responses — never guesses a trade', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"action":"yolo"}' }], usage: {} });
    await expect(generateDecision('user-1', CONTEXT, MODE)).rejects.toMatchObject({ status: 502 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('position actions validate against hasPosition from context', async () => {
    mockCreate.mockResolvedValue(claudeText({ ...GOOD, action: 'close' }));
    await expect(generateDecision('user-1', CONTEXT, MODE)).rejects.toMatchObject({ status: 502 });

    mockCreate.mockResolvedValue(claudeText({ ...GOOD, action: 'close' }));
    const withPos = { ...CONTEXT, position: { symbol: 'AAPL', position_type: 'long', quantity: 10, average_price: 140, pnl: 100 } };
    const d = await generateDecision('user-1', withPos, MODE);
    expect(d.action).toBe('close');
  });

  test('max mode sends extended thinking config', async () => {
    const maxMode = { ...MODE, decisionModel: 'model-top', maxTokens: 8192, thinkingBudget: 4096 };
    await generateDecision('user-1', CONTEXT, maxMode);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-top',
      thinking: { type: 'enabled', budget_tokens: 4096 },
    }));
  });
});

describe('screenSymbols', () => {
  test('returns the analyze list from the screening model', async () => {
    mockCreate.mockResolvedValue(claudeText({ analyze: ['AAPL'] }));
    const mode = { ...MODE, screeningModel: 'model-small' };
    const picked = await screenSymbols(
      [{ symbol: 'AAPL', current_price: 150, change_pct: 1.4, rsi_14: 55, has_position: false }], mode
    );
    expect(picked).toEqual(['AAPL']);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-small' }));
  });

  test('throws on malformed screening output', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'nope' }], usage: {} });
    await expect(screenSymbols([], { ...MODE, screeningModel: 'model-small' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/generateDecision.test.js --coverage=false`
Expected: FAIL — `generateDecision is not a function`

- [ ] **Step 3: Implement (append to `backend/src/services/aiAnalysis.js`; extend `module.exports`)**

Add near the top, after the existing requires:

```js
const { validateDecision } = require('./decisionSchema');
```

Append before `module.exports`:

```js
// ── Engine v2: fused multi-timeframe decision ────────────────────────────────

const DECISION_SYSTEM_PROMPT = `You are an expert algorithmic trader managing positions autonomously for one account. You are given fused multi-timeframe market data, portfolio state, and the currently open position for a symbol (if any).

Decide ONE action and respond ONLY with valid JSON (no markdown, no backticks):
{
  "action": "open_long" | "open_short" | "close" | "adjust_stop" | "partial_exit" | "add" | "hold",
  "confidence": <integer 0-100>,
  "reasoning": "<concise 2-4 sentence explanation>",
  "timeframe_alignment": {"<timeframe>": "bullish" | "bearish" | "neutral", ...},
  "entry_price": <number | null>,
  "stop_loss": <number | null>,
  "take_profit": <number | null>,
  "exit_fraction": <number strictly between 0 and 1 | null>,
  "risk_reward": <number | null>,
  "invalidation": "<one sentence: what would prove this decision wrong>"
}

Rules:
- With NO open position, the only valid actions are open_long, open_short, or hold.
- With an open position, manage it: close, adjust_stop, partial_exit, add, or hold. Do not propose open_long/open_short while a position exists.
- adjust_stop may only TIGHTEN the stop (raise it for longs, lower it for shorts).
- open_long, open_short, and add REQUIRE stop_loss. adjust_stop REQUIRES stop_loss. partial_exit REQUIRES exit_fraction.
- confidence < 50 must be "hold".
- Weigh higher timeframes more for direction, lower timeframes for timing.
- Base all analysis strictly on the provided data.`;

function formatCandles(candles) {
  return candles.map((c) =>
    `  ${String(c.time).slice(0, 16)} O:${c.open?.toFixed(2)} H:${c.high?.toFixed(2)} L:${c.low?.toFixed(2)} C:${c.close?.toFixed(2)} V:${c.volume?.toLocaleString()}`
  ).join('\n');
}

function formatIndicators(ind) {
  return [
    `RSI(14): ${ind.rsi_14 ?? 'N/A'}`,
    `MACD: ${ind.macd ? `${ind.macd.macd?.toFixed(4)} / sig ${ind.macd.signal?.toFixed(4)} / hist ${ind.macd.histogram?.toFixed(4)}` : 'N/A'}`,
    `SMA20/50/200: ${ind.sma_20 ?? 'N/A'} / ${ind.sma_50 ?? 'N/A'} / ${ind.sma_200 ?? 'N/A'}`,
    `BB: ${ind.bollinger_bands ? `${ind.bollinger_bands.upper?.toFixed(2)} / ${ind.bollinger_bands.middle?.toFixed(2)} / ${ind.bollinger_bands.lower?.toFixed(2)}` : 'N/A'}`,
    `ATR(14): ${ind.atr_14 ?? 'N/A'}  VWAP: ${ind.vwap ?? 'N/A'}`,
  ].join('  |  ');
}

function buildDecisionPrompt(context) {
  const { symbol, current_price, previous_close, timeframes, news, position, portfolio } = context;

  const portfolioSection = portfolio
    ? `## Portfolio
- Equity: ${portfolio.equity ?? 'N/A'}
- Open positions: ${portfolio.open_positions ?? 'N/A'}
- Exposure: ${portfolio.exposure_pct ?? 'N/A'}%
- Today's realized P&L: ${portfolio.todays_realized_pnl ?? 'N/A'}`
    : '## Portfolio\nNot available.';

  const positionSection = position
    ? `## Open Position in ${symbol}
- Direction: ${position.position_type}
- Quantity: ${position.quantity}
- Average entry: ${position.average_price}
- Unrealized P&L: ${position.pnl}`
    : `## Open Position in ${symbol}\nNone.`;

  const tfSections = Object.entries(timeframes).map(([tf, data]) =>
    `### ${tf} timeframe
Indicators: ${formatIndicators(data.indicators)}
Recent candles:
${formatCandles(data.candles)}`
  ).join('\n\n');

  const newsSection = news.length
    ? `## Recent News\n${news.map((n) => `- "${n.headline}" (${n.source}, ${String(n.created_at || '').slice(0, 10)})`).join('\n')}`
    : '## Recent News\nNone available.';

  return `Decide the next action for ${symbol}.

## Market Snapshot
- Current price: ${current_price}
- Previous close: ${previous_close}
- Change: ${previous_close ? (((current_price - previous_close) / previous_close) * 100).toFixed(2) : 'N/A'}%

${portfolioSection}

${positionSection}

## Multi-Timeframe Data
${tfSections}

${newsSection}`;
}

function extractText(message) {
  return (message.content || []).find((b) => b.type === 'text')?.text || '';
}

async function callDecisionModel(mode, prompt) {
  const request = {
    model: mode.decisionModel,
    max_tokens: mode.maxTokens,
    system: [{ type: 'text', text: DECISION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  };
  if (mode.thinkingBudget) {
    request.thinking = { type: 'enabled', budget_tokens: mode.thinkingBudget };
  }
  const message = await getClient().messages.create(request);
  return {
    text: extractText(message),
    tokensUsed: (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0),
  };
}

async function generateDecision(userId, context, mode) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(new Error('AI analysis not configured (ANTHROPIC_API_KEY missing)'), { status: 503 });
  }
  const prompt = buildDecisionPrompt(context);
  const hasPosition = Boolean(context.position);

  let decision = null;
  let tokensUsed = 0;
  let lastErrors = [];
  for (let attempt = 0; attempt < 2 && !decision; attempt++) {
    let text;
    try {
      const res = await callDecisionModel(mode, prompt);
      text = res.text;
      tokensUsed += res.tokensUsed;
    } catch (err) {
      logger.error({ err: err.message, symbol: context.symbol }, 'Anthropic API error');
      throw Object.assign(new Error(`AI service error: ${err.message}`), { status: 502 });
    }
    try {
      const parsed = JSON.parse(text.trim());
      const result = validateDecision(parsed, { hasPosition });
      if (result.ok) decision = result.decision;
      else lastErrors = result.errors;
    } catch {
      lastErrors = ['malformed JSON'];
    }
  }
  if (!decision) {
    throw Object.assign(
      new Error(`AI returned invalid decision after retry: ${lastErrors.join('; ')}`), { status: 502 }
    );
  }

  // Persist entries as historical signals so signal-performance tracking
  // keeps working. Position-management actions live in auto_trading_runs only.
  let signalId = null;
  if (decision.action === 'open_long' || decision.action === 'open_short') {
    const signalType = decision.action === 'open_long' ? 'buy' : 'sell';
    try {
      const row = await db.one(
        `INSERT INTO historical_signals
           (user_id, symbol, timeframe, signal_type, confidence, analysis_text,
            ai_model, ai_tokens_used, entry_price, stop_loss, take_profit,
            indicators, expires_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                 CURRENT_TIMESTAMP + INTERVAL '4 hours', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`,
        [
          userId, context.symbol, Object.keys(context.timeframes).join('+'), signalType,
          decision.confidence, decision.reasoning, mode.decisionModel, tokensUsed,
          context.current_price, decision.stop_loss, decision.take_profit,
          JSON.stringify({ timeframe_alignment: decision.timeframe_alignment, invalidation: decision.invalidation }),
        ]
      );
      signalId = row.id;
    } catch (dbErr) {
      logger.warn({ err: dbErr.message }, 'Failed to persist decision signal');
    }
  }

  logger.info(
    { symbol: context.symbol, action: decision.action, confidence: decision.confidence, model: mode.decisionModel, tokens: tokensUsed },
    'Decision generated'
  );
  return { ...decision, id: signalId, ai_model: mode.decisionModel, ai_tokens_used: tokensUsed };
}

// ── Tiered-mode screening pass ───────────────────────────────────────────────

const SCREENING_SYSTEM_PROMPT = `You are a market screener. Given one-line summaries of symbols, pick ONLY those with a potentially actionable setup worth deep analysis right now. Respond ONLY with valid JSON: {"analyze": ["SYM1", ...]}. An empty list is a valid answer.`;

async function screenSymbols(summaries, mode) {
  const lines = summaries.map((s) =>
    `- ${s.symbol}: price ${s.current_price}, change ${s.change_pct}%, RSI(14) ${s.rsi_14 ?? 'N/A'}, open position: ${s.has_position ? 'yes' : 'no'}`
  ).join('\n');

  const message = await getClient().messages.create({
    model: mode.screeningModel,
    max_tokens: 300,
    system: SCREENING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Symbols:\n${lines}` }],
  });
  const parsed = JSON.parse(extractText(message).trim());
  if (!Array.isArray(parsed.analyze)) throw new Error('screening returned no analyze list');
  const valid = new Set(summaries.map((s) => s.symbol));
  return parsed.analyze.filter((s) => valid.has(s));
}
```

Change the exports line to:

```js
module.exports = { generateSignal, generateDecision, screenSymbols };
```

- [ ] **Step 4: Run tests to verify they pass, plus existing aiAnalysis tests**

Run: `cd backend && npx jest src/__tests__/phase8/generateDecision.test.js --coverage=false && npx jest aiAnalysis --coverage=false`
Expected: PASS, no regressions

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/aiAnalysis.js backend/src/__tests__/phase8/generateDecision.test.js
git commit -m "feat: fused decision generation with retry, thinking, and tiered screening"
```

---

### Task 8: Decision executor + new emails

**Files:**
- Create: `backend/src/services/engineActions.js`
- Modify: `backend/src/services/emailService.js`
- Test: `backend/src/__tests__/phase8/engineActions.test.js`

**Interfaces:**
- Consumes: `placeOrder` (existing, signature `placeOrder({ userId, brokerConnectionId, conn, symbol, side, orderType, quantity, price, stopLoss, takeProfit, signalId, source })`), risk helpers (Task 4), adapter capabilities (Task 5), `sendEmail`-based helpers.
- Produces:
  - `executeDecision({ db, adapter, conn, userId, userEmail, settings, symbol, position, decision, equity }) → { action, orderId?, errorMessage?, detail? }` where `action` is one of: `order_placed | position_added | position_closed | partial_exit | stop_adjusted | skipped_unsupported_broker | skipped_risk_sizing | skipped_stop_widening | needs_attention | error`.
  - `sendAutoTradingActionEmail(email, { symbol, action, detail })` and `sendAutoTradingNeedsAttentionEmail(email, { symbol, message })` in emailService.

- [ ] **Step 1: Add the two email helpers to `backend/src/services/emailService.js`** (after `sendAutoTradingDisabledEmail`, using the existing `sendEmail(to, subject, html)` helper; add both to `module.exports`):

```js
async function sendAutoTradingActionEmail(email, { symbol, action, detail }) {
  const label = String(action).replace(/_/g, ' ');
  await sendEmail(
    email,
    `SignalPro auto-trading: ${label} — ${symbol}`,
    `<p>The autonomous engine executed <strong>${label}</strong> on <strong>${symbol}</strong>.</p>
     <p>${detail || ''}</p>
     <p>Review the activity feed on the Auto Trading page for full reasoning.</p>`
  );
}

async function sendAutoTradingNeedsAttentionEmail(email, { symbol, message }) {
  await sendEmail(
    email,
    `SignalPro auto-trading NEEDS ATTENTION — ${symbol}`,
    `<p><strong>Manual review required for ${symbol}.</strong></p>
     <p>${message}</p>
     <p>Check your broker account directly — the engine may have left the position without protective orders.</p>`
  );
}
```

- [ ] **Step 2: Write the failing tests**

```js
// backend/src/__tests__/phase8/engineActions.test.js
const mockPlaceOrder = jest.fn();
jest.mock('../../services/orderExecution', () => ({ placeOrder: mockPlaceOrder }));

const mockActionEmail = jest.fn();
const mockAttentionEmail = jest.fn();
jest.mock('../../services/emailService', () => ({
  sendAutoTradingActionEmail: mockActionEmail,
  sendAutoTradingNeedsAttentionEmail: mockAttentionEmail,
}));

const { executeDecision } = require('../../services/engineActions');

const CONN = { id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc' };
const SETTINGS = { risk_per_trade_pct: 0.01 };
const LONG_POSITION = { symbol: 'AAPL', position_type: 'long', quantity: 10, average_price: 140, pnl: 100 };

function makeAdapter(overrides = {}) {
  return {
    capabilities: () => ['place_order', 'cancel_order', 'close_position', 'replace_order', 'open_orders'],
    getOpenOrders: jest.fn().mockResolvedValue([]),
    cancelOrder: jest.fn().mockResolvedValue(true),
    closePosition: jest.fn().mockResolvedValue({ order_id: 'b-1', status: 'pending', message: 'ok' }),
    replaceOrder: jest.fn().mockResolvedValue({ order_id: 'b-2', status: 'pending', message: 'ok' }),
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    action: 'open_long', confidence: 80, reasoning: 'r', timeframe_alignment: {},
    entry_price: 150, stop_loss: 145, take_profit: 160, exit_fraction: null,
    risk_reward: 2, invalidation: 'x', id: 'sig-1',
    ...overrides,
  };
}

function run(overrides = {}) {
  return executeDecision({
    db: {}, adapter: makeAdapter(), conn: CONN, userId: 'user-1', userEmail: 'u@x.com',
    settings: SETTINGS, symbol: 'AAPL', position: null, decision: decision(), equity: 100000,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPlaceOrder.mockResolvedValue({ id: 'order-1' });
  mockActionEmail.mockResolvedValue(undefined);
  mockAttentionEmail.mockResolvedValue(undefined);
});

describe('capability gating', () => {
  test('unsupported broker is skipped, never a silent no-op', async () => {
    const adapter = { capabilities: () => [] };
    const res = await run({ adapter });
    expect(res.action).toBe('skipped_unsupported_broker');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });
});

describe('open_long / open_short', () => {
  test('sizes via risk and places a bracket market order', async () => {
    const res = await run();
    // equity 100000 * 1% = 1000 risk; per-unit risk 5 → 200; affordable 666 → 200
    expect(mockPlaceOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'AAPL', side: 'buy', quantity: 200, stopLoss: 145, takeProfit: 160,
      signalId: 'sig-1', source: 'auto_engine',
    }));
    expect(res).toMatchObject({ action: 'order_placed', orderId: 'order-1' });
  });

  test('open_short sells', async () => {
    await run({ decision: decision({ action: 'open_short' }) });
    expect(mockPlaceOrder).toHaveBeenCalledWith(expect.objectContaining({ side: 'sell' }));
  });

  test('zero sizing skips', async () => {
    const res = await run({ equity: 0 });
    expect(res.action).toBe('skipped_risk_sizing');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });
});

describe('add', () => {
  test('adds in the direction of the position', async () => {
    const res = await run({ position: LONG_POSITION, decision: decision({ action: 'add', id: null }) });
    expect(mockPlaceOrder).toHaveBeenCalledWith(expect.objectContaining({ side: 'buy', source: 'auto_engine' }));
    expect(res.action).toBe('position_added');
  });
});

describe('close', () => {
  test('cancels open orders then closes; emails the action', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockResolvedValue([
        { broker_order_id: 'stop-1', order_type: 'stop', stop_price: 145 },
      ]),
    });
    const res = await run({ adapter, position: LONG_POSITION, decision: decision({ action: 'close' }) });
    expect(adapter.cancelOrder).toHaveBeenCalledWith('stop-1');
    expect(adapter.closePosition).toHaveBeenCalledWith('AAPL');
    expect(res.action).toBe('position_closed');
    expect(mockActionEmail).toHaveBeenCalled();
  });

  test('close failure AFTER cancels is needs_attention with email', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockResolvedValue([{ broker_order_id: 'stop-1', order_type: 'stop', stop_price: 145 }]),
      closePosition: jest.fn().mockRejectedValue(new Error('rejected')),
    });
    const res = await run({ adapter, position: LONG_POSITION, decision: decision({ action: 'close' }) });
    expect(res.action).toBe('needs_attention');
    expect(mockAttentionEmail).toHaveBeenCalledWith('u@x.com', expect.objectContaining({ symbol: 'AAPL' }));
  });

  test('cancel failure BEFORE close is a plain error (position still protected)', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockRejectedValue(new Error('api down')),
    });
    const res = await run({ adapter, position: LONG_POSITION, decision: decision({ action: 'close' }) });
    expect(res.action).toBe('error');
    expect(adapter.closePosition).not.toHaveBeenCalled();
  });
});

describe('partial_exit', () => {
  test('closes the computed fraction', async () => {
    const adapter = makeAdapter();
    const res = await run({
      adapter, position: LONG_POSITION,
      decision: decision({ action: 'partial_exit', exit_fraction: 0.5 }),
    });
    expect(adapter.closePosition).toHaveBeenCalledWith('AAPL', 5);
    expect(res.action).toBe('partial_exit');
    expect(res.detail).toMatchObject({ quantity: 5, remaining: 5, unprotected_remainder: true });
  });

  test('unsizable fraction skips', async () => {
    const res = await run({
      position: { ...LONG_POSITION, quantity: 1 },
      decision: decision({ action: 'partial_exit', exit_fraction: 0.5 }),
    });
    expect(res.action).toBe('skipped_risk_sizing');
  });
});

describe('adjust_stop', () => {
  test('replaces the open stop order when tightening', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockResolvedValue([{ broker_order_id: 'stop-1', order_type: 'stop', stop_price: 145 }]),
    });
    const res = await run({
      adapter, position: LONG_POSITION,
      decision: decision({ action: 'adjust_stop', stop_loss: 148 }),
    });
    expect(adapter.replaceOrder).toHaveBeenCalledWith('stop-1', { stop_price: 148 });
    expect(res.action).toBe('stop_adjusted');
    expect(res.detail).toMatchObject({ from: 145, to: 148 });
  });

  test('widening is refused deterministically', async () => {
    const adapter = makeAdapter({
      getOpenOrders: jest.fn().mockResolvedValue([{ broker_order_id: 'stop-1', order_type: 'stop', stop_price: 145 }]),
    });
    const res = await run({
      adapter, position: LONG_POSITION,
      decision: decision({ action: 'adjust_stop', stop_loss: 140 }),
    });
    expect(res.action).toBe('skipped_stop_widening');
    expect(adapter.replaceOrder).not.toHaveBeenCalled();
  });

  test('no open stop order is an error', async () => {
    const res = await run({
      position: LONG_POSITION,
      decision: decision({ action: 'adjust_stop', stop_loss: 148 }),
    });
    expect(res.action).toBe('error');
    expect(res.errorMessage).toMatch(/no open stop order/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/engineActions.test.js --coverage=false`
Expected: FAIL — `Cannot find module '../../services/engineActions'`

- [ ] **Step 4: Implement**

```js
// backend/src/services/engineActions.js
// Executes a validated, authority-approved decision against the broker.
// Every path returns an action string for the run log — never a silent no-op.

const riskManagement = require('./riskManagement');
const { placeOrder } = require('./orderExecution');
const {
  sendAutoTradingActionEmail,
  sendAutoTradingNeedsAttentionEmail,
} = require('./emailService');
const logger = require('../config/logger');

const CAPABILITY_REQUIREMENTS = {
  open_long: ['place_order'],
  open_short: ['place_order'],
  add: ['place_order'],
  close: ['open_orders', 'cancel_order', 'close_position'],
  partial_exit: ['open_orders', 'cancel_order', 'close_position'],
  adjust_stop: ['open_orders', 'replace_order'],
};

function hasCapabilities(adapter, action) {
  const caps = typeof adapter.capabilities === 'function' ? adapter.capabilities() : [];
  return (CAPABILITY_REQUIREMENTS[action] || []).every((c) => caps.includes(c));
}

function notify(userEmail, symbol, action, detail) {
  if (!userEmail) return;
  sendAutoTradingActionEmail(userEmail, { symbol, action, detail }).catch((err) =>
    logger.error({ symbol, err: err.message }, 'Failed to send auto-trading action email')
  );
}

async function attention(userEmail, symbol, message) {
  if (!userEmail) return;
  await sendAutoTradingNeedsAttentionEmail(userEmail, { symbol, message }).catch((err) =>
    logger.error({ symbol, err: err.message }, 'Failed to send needs-attention email')
  );
}

async function openOrAdd({ conn, userId, userEmail, settings, symbol, position, decision, equity }) {
  const quantity = riskManagement.calculatePositionSize({
    equity,
    riskPerTradePct: settings.risk_per_trade_pct,
    entryPrice: decision.entry_price,
    stopLoss: decision.stop_loss,
  });
  if (quantity <= 0) return { action: 'skipped_risk_sizing' };

  let side;
  if (decision.action === 'add') side = position.position_type === 'long' ? 'buy' : 'sell';
  else side = decision.action === 'open_long' ? 'buy' : 'sell';

  const order = await placeOrder({
    userId, brokerConnectionId: conn.id, conn, symbol, side, orderType: 'market',
    quantity, price: decision.entry_price, stopLoss: decision.stop_loss,
    takeProfit: decision.take_profit, signalId: decision.id, source: 'auto_engine',
  });
  notify(userEmail, symbol, decision.action, `${side} ${quantity} @ ~${decision.entry_price}`);
  return {
    action: decision.action === 'add' ? 'position_added' : 'order_placed',
    orderId: order.id,
    detail: { side, quantity },
  };
}

// Cancels the symbol's open (protective) orders. Throwing here is safe:
// nothing has been cancelled or closed yet.
async function cancelOpenOrders(adapter, symbol) {
  const orders = await adapter.getOpenOrders(symbol);
  for (const o of orders) await adapter.cancelOrder(o.broker_order_id);
  return orders;
}

async function closeFully({ adapter, userEmail, symbol }) {
  let cancelled;
  try {
    cancelled = await cancelOpenOrders(adapter, symbol);
  } catch (err) {
    return { action: 'error', errorMessage: `failed to cancel open orders before close: ${err.message}` };
  }
  try {
    const result = await adapter.closePosition(symbol);
    notify(userEmail, symbol, 'position_closed', result.message);
    return { action: 'position_closed', detail: { broker_order_id: result.order_id, cancelled_orders: cancelled.length } };
  } catch (err) {
    // Protective orders are gone but the position is still open — unprotected.
    await attention(userEmail, symbol, `Close failed after protective orders were cancelled: ${err.message}`);
    return { action: 'needs_attention', errorMessage: err.message, detail: { cancelled_orders: cancelled.length } };
  }
}

async function partialExit({ adapter, userEmail, symbol, position, decision }) {
  const quantity = riskManagement.partialExitQuantity({
    positionQty: position.quantity,
    exitFraction: decision.exit_fraction,
  });
  if (quantity <= 0) return { action: 'skipped_risk_sizing' };
  if (quantity >= position.quantity) return closeFully({ adapter, userEmail, symbol });

  let cancelled;
  try {
    cancelled = await cancelOpenOrders(adapter, symbol);
  } catch (err) {
    return { action: 'error', errorMessage: `failed to cancel open orders before partial exit: ${err.message}` };
  }
  try {
    const result = await adapter.closePosition(symbol, quantity);
    const remaining = position.quantity - quantity;
    notify(userEmail, symbol, 'partial_exit', `sold ${quantity}, ${remaining} remaining (unprotected until next cycle)`);
    return {
      action: 'partial_exit',
      detail: {
        broker_order_id: result.order_id, quantity, remaining,
        cancelled_orders: cancelled.length,
        // The remainder has no bracket until the next cycle adjusts/closes.
        unprotected_remainder: true,
      },
    };
  } catch (err) {
    await attention(userEmail, symbol, `Partial exit failed after protective orders were cancelled: ${err.message}`);
    return { action: 'needs_attention', errorMessage: err.message, detail: { cancelled_orders: cancelled.length } };
  }
}

async function adjustStop({ adapter, userEmail, symbol, position, decision }) {
  const orders = await adapter.getOpenOrders(symbol);
  const stopOrder = orders.find((o) => String(o.order_type || '').includes('stop'));
  if (!stopOrder) {
    return { action: 'error', errorMessage: 'no open stop order to adjust' };
  }
  const ok = riskManagement.validateStopAdjustment({
    positionType: position.position_type,
    currentStop: stopOrder.stop_price,
    newStop: decision.stop_loss,
  });
  if (!ok) return { action: 'skipped_stop_widening', detail: { current_stop: stopOrder.stop_price, proposed: decision.stop_loss } };

  const result = await adapter.replaceOrder(stopOrder.broker_order_id, { stop_price: decision.stop_loss });
  notify(userEmail, symbol, 'stop_adjusted', `stop moved ${stopOrder.stop_price} → ${decision.stop_loss}`);
  return { action: 'stop_adjusted', detail: { from: stopOrder.stop_price, to: decision.stop_loss, broker_order_id: result.order_id } };
}

async function executeDecision(params) {
  const { adapter, decision } = params;
  if (!hasCapabilities(adapter, decision.action)) {
    return { action: 'skipped_unsupported_broker' };
  }
  try {
    switch (decision.action) {
      case 'open_long':
      case 'open_short':
      case 'add':
        return await openOrAdd(params);
      case 'close':
        return await closeFully(params);
      case 'partial_exit':
        return await partialExit(params);
      case 'adjust_stop':
        return await adjustStop(params);
      default:
        return { action: 'error', errorMessage: `unknown action ${decision.action}` };
    }
  } catch (err) {
    return { action: 'error', errorMessage: err.message };
  }
}

module.exports = { executeDecision, hasCapabilities, CAPABILITY_REQUIREMENTS };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/phase8/engineActions.test.js --coverage=false`
Expected: PASS (13 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/engineActions.js backend/src/services/emailService.js backend/src/__tests__/phase8/engineActions.test.js
git commit -m "feat: decision executor with close/partial/stop-adjust and attention emails"
```

---

### Task 9: Engine orchestration rework

**Files:**
- Modify: `backend/src/services/autoTradingEngine.js` (substantial rewrite of the cycle internals; cron schedule, circuit breaker, and settings plumbing survive)
- Test: `backend/src/__tests__/phase8/autoTradingEngineV2.test.js`
- Note: the v1 test `backend/src/__tests__/phase7/autoTradingEngine.test.js` tests `analyzeAndTrade`, which this task removes. **Delete `describe('analyzeAndTrade')` blocks from the phase7 file and keep its settings/circuit-breaker tests**; equivalent coverage moves to phase8.

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces (exports): `runAutoTradingCycle`, `startAutoTradingCron`, `getAutoTradingSettings`, `DEFAULT_SETTINGS`, `runForUser`, `processSymbol`, `checkCircuitBreaker`, `CIRCUIT_BREAKER_ERROR_THRESHOLD`. `DEFAULT_SETTINGS` gains `ai_mode: 'balanced'` and `authority: riskManagement.DEFAULT_AUTHORITY`; `getAutoTradingSettings` deep-merges `authority`. Task 10's routes and Task 11's benchmark service consume `getAutoTradingSettings`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase8/autoTradingEngineV2.test.js
const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
const mockDecryptCredentials = jest.fn();
const mockGetAdapter = jest.fn();
const mockBuildMarketContext = jest.fn();
const mockBuildScreeningSummaries = jest.fn();
const mockGenerateDecision = jest.fn();
const mockScreenSymbols = jest.fn();
const mockExecuteDecision = jest.fn();
const mockDailyLossEmail = jest.fn();
const mockDisabledEmail = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/brokerEncryption', () => ({ decryptCredentials: mockDecryptCredentials }));
jest.mock('../../services/brokers/index', () => ({ getAdapter: mockGetAdapter }));
jest.mock('../../services/marketContext', () => ({
  buildMarketContext: mockBuildMarketContext,
  buildScreeningSummaries: mockBuildScreeningSummaries,
}));
jest.mock('../../services/aiAnalysis', () => ({
  generateDecision: mockGenerateDecision,
  screenSymbols: mockScreenSymbols,
}));
jest.mock('../../services/engineActions', () => ({ executeDecision: mockExecuteDecision }));
jest.mock('../../services/emailService', () => ({
  sendAutoTradingDailyLossLimitEmail: mockDailyLossEmail,
  sendAutoTradingDisabledEmail: mockDisabledEmail,
}));

const {
  runForUser, processSymbol, getAutoTradingSettings, DEFAULT_SETTINGS,
} = require('../../services/autoTradingEngine');

const USER_ID = 'user-1';
const EMAIL = 'u@x.com';
const CONN = { id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc' };

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  enabled: true,
  broker_connection_id: CONN.id,
  symbols: ['AAPL'],
  timeframes: ['1h', '4h'],
  min_confidence: 70,
};

function decision(overrides = {}) {
  return {
    action: 'open_long', confidence: 82, reasoning: 'r', timeframe_alignment: {},
    entry_price: 150, stop_loss: 145, take_profit: 160, exit_fraction: null,
    risk_reward: 2, invalidation: 'x', id: 'sig-1', ai_model: 'm', ai_tokens_used: 10,
    ...overrides,
  };
}

let adapter;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AUTO_TRADING_ENABLED;
  adapter = {
    getAccountInfo: jest.fn().mockResolvedValue({ funds: { equity: 100000 } }),
    getPositions: jest.fn().mockResolvedValue([]),
  };
  mockDecryptCredentials.mockReturnValue({ api_key: 'k' });
  mockGetAdapter.mockReturnValue(adapter);
  mockDb.none.mockResolvedValue(undefined);
  mockDb.manyOrNone.mockResolvedValue([]); // circuit breaker clear
  // oneOrNone: broker connection row, cooldown row (null)
  mockDb.oneOrNone.mockImplementation((sql) => {
    if (/broker_connections/.test(sql)) return Promise.resolve(CONN);
    return Promise.resolve(null);
  });
  // one: trades-today count, realized pnl
  mockDb.one.mockImplementation((sql) => {
    if (/COUNT/.test(sql)) return Promise.resolve({ count: '0' });
    return Promise.resolve({ realized_pnl: '0' });
  });
  mockBuildMarketContext.mockResolvedValue({ symbol: 'AAPL', current_price: 150, timeframes: { '1h': {} }, news: [], position: null, portfolio: {} });
  mockGenerateDecision.mockResolvedValue(decision());
  mockExecuteDecision.mockResolvedValue({ action: 'order_placed', orderId: 'order-1' });
});

function lastRunLog() {
  const calls = mockDb.none.mock.calls.filter(([sql]) => /INSERT INTO auto_trading_runs/.test(sql));
  return calls[calls.length - 1]?.[1];
}

describe('settings', () => {
  test('defaults include ai_mode and authority', () => {
    expect(DEFAULT_SETTINGS.ai_mode).toBe('balanced');
    expect(DEFAULT_SETTINGS.authority).toEqual({ close: true, adjust_stop: false, partial_exit: false, add: false });
  });

  test('authority deep-merges over defaults', () => {
    const s = getAutoTradingSettings({ auto_trading: { authority: { adjust_stop: true } } });
    expect(s.authority).toEqual({ close: true, adjust_stop: true, partial_exit: false, add: false });
  });
});

describe('runForUser', () => {
  test('happy path: analyzes watchlist symbol and executes', async () => {
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockGenerateDecision).toHaveBeenCalledTimes(1);
    expect(mockExecuteDecision).toHaveBeenCalledTimes(1);
    const log = lastRunLog();
    expect(log[5]).toBe('order_placed'); // action param position in logRun insert
  });

  test('universe includes open-position symbols not on the watchlist', async () => {
    adapter.getPositions.mockResolvedValue([{ symbol: 'TSLA', position_type: 'long', quantity: 5, average_price: 200, pnl: 10, market_value: 1000 }]);
    await runForUser(USER_ID, SETTINGS, EMAIL);
    const symbols = mockBuildMarketContext.mock.calls.map(([args]) => args.symbol);
    expect(symbols).toEqual(expect.arrayContaining(['AAPL', 'TSLA']));
  });

  test('daily loss limit blocks entries but position management continues', async () => {
    mockDb.one.mockImplementation((sql) => {
      if (/COUNT/.test(sql)) return Promise.resolve({ count: '0' });
      return Promise.resolve({ realized_pnl: '-5000' }); // -5000 >= 3% of 100000
    });
    adapter.getPositions.mockResolvedValue([{ symbol: 'TSLA', position_type: 'long', quantity: 5, average_price: 200, pnl: 10, market_value: 1000 }]);
    mockGenerateDecision
      .mockResolvedValueOnce(decision({ action: 'open_long' }))   // AAPL entry → blocked
      .mockResolvedValueOnce(decision({ action: 'close' }));      // TSLA exit → allowed
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockExecuteDecision).toHaveBeenCalledTimes(1);
    expect(mockExecuteDecision.mock.calls[0][0].decision.action).toBe('close');
    expect(mockDailyLossEmail).toHaveBeenCalled();
  });

  test('positions fetch failure fails closed: no decisions at all this cycle', async () => {
    adapter.getPositions.mockRejectedValue(new Error('broker down'));
    await runForUser(USER_ID, SETTINGS, EMAIL);
    expect(mockGenerateDecision).not.toHaveBeenCalled();
    const log = lastRunLog();
    expect(log[5]).toBe('error');
  });

  test('tiered mode screens symbols; screened-out symbols are logged', async () => {
    mockBuildScreeningSummaries.mockResolvedValue({
      summaries: [{ symbol: 'AAPL', has_position: false }, { symbol: 'MSFT', has_position: false }],
      unscreenable: [],
    });
    mockScreenSymbols.mockResolvedValue(['MSFT']);
    await runForUser(USER_ID, { ...SETTINGS, symbols: ['AAPL', 'MSFT'], ai_mode: 'tiered' }, EMAIL);
    const analyzed = mockBuildMarketContext.mock.calls.map(([args]) => args.symbol);
    expect(analyzed).toEqual(['MSFT']);
    const screenedOut = mockDb.none.mock.calls.find(
      ([sql, params]) => /auto_trading_runs/.test(sql) && params[5] === 'screened_out'
    );
    expect(screenedOut).toBeTruthy();
  });

  test('screening failure fails open: everything is analyzed', async () => {
    mockBuildScreeningSummaries.mockResolvedValue({ summaries: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }], unscreenable: [] });
    mockScreenSymbols.mockRejectedValue(new Error('screen down'));
    await runForUser(USER_ID, { ...SETTINGS, symbols: ['AAPL', 'MSFT'], ai_mode: 'tiered' }, EMAIL);
    expect(mockBuildMarketContext).toHaveBeenCalledTimes(2);
  });
});

describe('processSymbol gating', () => {
  const base = () => ({
    userId: USER_ID, userEmail: EMAIL,
    settings: SETTINGS, conn: CONN, adapter,
    mode: { name: 'balanced', contextProfile: 'full', screeningModel: null },
    symbol: 'AAPL', position: null,
    portfolio: { equity: 100000 }, entryBlocked: null, equity: 100000,
  });

  test('hold is logged, not executed', async () => {
    mockGenerateDecision.mockResolvedValue(decision({ action: 'hold', confidence: 30 }));
    await processSymbol(base());
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('hold');
  });

  test('low confidence skips', async () => {
    mockGenerateDecision.mockResolvedValue(decision({ confidence: 50 }));
    await processSymbol(base());
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('skipped_low_confidence');
  });

  test('authority denial skips', async () => {
    const position = { symbol: 'AAPL', position_type: 'long', quantity: 10, average_price: 140, pnl: 50 };
    mockGenerateDecision.mockResolvedValue(decision({ action: 'partial_exit', exit_fraction: 0.5 }));
    await processSymbol({ ...base(), position });
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('skipped_authority');
  });

  test('cooldown blocks entries', async () => {
    mockDb.oneOrNone.mockImplementation((sql) => {
      if (/broker_connections/.test(sql)) return Promise.resolve(CONN);
      if (/cooldown|INTERVAL/.test(sql)) return Promise.resolve({ id: 'recent' });
      return Promise.resolve(null);
    });
    await processSymbol(base());
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('skipped_cooldown');
  });

  test('open_long with an existing position is a conflict skip', async () => {
    const position = { symbol: 'AAPL', position_type: 'short', quantity: 10, average_price: 140, pnl: 0 };
    mockGenerateDecision.mockResolvedValue(decision({ action: 'open_long' }));
    await processSymbol({ ...base(), position });
    expect(mockExecuteDecision).not.toHaveBeenCalled();
    expect(lastRunLog()[5]).toBe('skipped_existing_position');
  });

  test('run log includes action_detail JSON', async () => {
    await processSymbol(base());
    const insert = mockDb.none.mock.calls.find(([sql]) => /INSERT INTO auto_trading_runs/.test(sql));
    const params = insert[1];
    const detail = JSON.parse(params[params.length - 1]);
    expect(detail.decision.action).toBe('open_long');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/autoTradingEngineV2.test.js --coverage=false`
Expected: FAIL — `processSymbol is not a function`

- [ ] **Step 3: Rewrite `backend/src/services/autoTradingEngine.js`**

Full replacement content:

```js
// Autonomous trading engine v2: each cycle fuses multi-timeframe data per
// symbol into ONE Claude decision (entry, exit, or adjustment), then runs it
// through deterministic guardrails before touching the broker.
// Claude proposes; code disposes.

const cron = require('node-cron');
const { db } = require('../config/database');
const { decryptCredentials } = require('../config/brokerEncryption');
const { getAdapter } = require('./brokers/index');
const { buildMarketContext, buildScreeningSummaries } = require('./marketContext');
const { generateDecision, screenSymbols } = require('./aiAnalysis');
const { resolveAiMode } = require('./aiModes');
const { ENTRY_ACTIONS } = require('./decisionSchema');
const riskManagement = require('./riskManagement');
const { executeDecision } = require('./engineActions');
const {
  sendAutoTradingDailyLossLimitEmail,
  sendAutoTradingDisabledEmail,
} = require('./emailService');
const logger = require('../config/logger');

// If a user's last N runs all errored out, auto-trading is disabled for that
// user so a persistent failure doesn't loop forever without anyone noticing.
const CIRCUIT_BREAKER_ERROR_THRESHOLD = 5;

// In-memory dedupe so the daily-loss-limit email is sent at most once per
// user per day.
const dailyLossLimitNotified = new Map();

function shouldNotifyDailyLossLimit(userId) {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyLossLimitNotified.get(userId) === today) return false;
  dailyLossLimitNotified.set(userId, today);
  return true;
}

const DEFAULT_SETTINGS = {
  enabled: false,
  broker_connection_id: null,
  symbols: [],
  timeframes: ['1h'],
  min_confidence: 70,
  risk_per_trade_pct: riskManagement.DEFAULT_RISK_PER_TRADE_PCT,
  max_daily_loss_pct: riskManagement.DEFAULT_MAX_DAILY_LOSS_PCT,
  cooldown_minutes: 60,
  max_trades_per_day: 5,
  ai_mode: 'balanced',
  authority: { ...riskManagement.DEFAULT_AUTHORITY },
};

function getAutoTradingSettings(preferences) {
  const stored = preferences?.auto_trading || {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    authority: { ...riskManagement.DEFAULT_AUTHORITY, ...(stored.authority || {}) },
  };
}

// ── Cycle entry point ─────────────────────────────────────────────────────────

async function runAutoTradingCycle() {
  if (process.env.AUTO_TRADING_ENABLED === 'false') {
    logger.info('Auto-trading disabled via AUTO_TRADING_ENABLED env var — skipping cycle');
    return;
  }

  const users = await db.manyOrNone(
    `SELECT id, email, preferences FROM users WHERE preferences->'auto_trading'->>'enabled' = 'true'`
  );

  logger.info(`Auto-trading: running cycle for ${users.length} user(s)`);
  await Promise.allSettled(users.map((u) => runForUser(u.id, getAutoTradingSettings(u.preferences), u.email)));
}

async function checkCircuitBreaker(userId) {
  const recent = (await db.manyOrNone(
    `SELECT action FROM auto_trading_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, CIRCUIT_BREAKER_ERROR_THRESHOLD]
  )) || [];
  return recent.length === CIRCUIT_BREAKER_ERROR_THRESHOLD && recent.every((r) => r.action === 'error');
}

async function disableAutoTrading(userId, settings) {
  const merged = { ...settings, enabled: false };
  await db.none(
    `UPDATE users
     SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{auto_trading}', $1::jsonb),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [JSON.stringify(merged), userId]
  );
}

// ── Per-user cycle ────────────────────────────────────────────────────────────

async function runForUser(userId, settings, userEmail) {
  if (!settings.broker_connection_id) return;

  if (await checkCircuitBreaker(userId)) {
    await disableAutoTrading(userId, settings);
    await logRun({ userId, symbol: 'ALL', timeframe: '-', action: 'auto_disabled_errors' });
    if (userEmail) {
      await sendAutoTradingDisabledEmail(userEmail).catch((err) =>
        logger.error({ userId, err: err.message }, 'Failed to send auto-trading disabled email')
      );
    }
    return;
  }

  const conn = await db.oneOrNone(
    `SELECT id, broker_id, credentials_encrypted FROM broker_connections
     WHERE id = $1 AND user_id = $2 AND status = 'connected'`,
    [settings.broker_connection_id, userId]
  );
  if (!conn) return;

  let adapter;
  try {
    adapter = getAdapter(conn.broker_id, decryptCredentials(conn.credentials_encrypted));
  } catch (err) {
    return logRun({ userId, symbol: 'ALL', timeframe: '-', action: 'error', errorMessage: `broker adapter: ${err.message}` });
  }

  // Positions are ground truth from the broker. If we can't see them we can
  // neither open safely nor manage what exists — skip the whole cycle.
  let brokerPositions;
  try {
    brokerPositions = await adapter.getPositions();
  } catch (err) {
    return logRun({ userId, symbol: 'ALL', timeframe: '-', action: 'error', errorMessage: `positions fetch failed: ${err.message}` });
  }
  const positionsBySymbol = new Map(brokerPositions.map((p) => [p.symbol, p]));

  // Entry gate: fail closed for entries, fail safe for exits. entryBlocked is
  // an action string used to log why entries were blocked this cycle.
  let equity = null;
  let entryBlocked = null;
  try {
    const account = await adapter.getAccountInfo();
    equity = account?.funds?.equity;
    await riskManagement.checkDailyLossLimit({ db, userId, equity, maxDailyLossPct: settings.max_daily_loss_pct });
  } catch (err) {
    if (err.code === 'RISK_LIMIT_EXCEEDED') {
      entryBlocked = 'skipped_daily_loss_limit';
      if (userEmail && shouldNotifyDailyLossLimit(userId)) {
        await sendAutoTradingDailyLossLimitEmail(userEmail).catch((emailErr) =>
          logger.error({ userId, err: emailErr.message }, 'Failed to send daily loss limit email')
        );
      }
    } else {
      entryBlocked = 'skipped_entry_blocked';
      logger.warn({ userId, err: err.message }, 'Entry guardrails unavailable — blocking entries this cycle');
    }
  }

  const { realized_pnl } = await db.one(
    `SELECT COALESCE(SUM(pnl), 0) as realized_pnl FROM positions
     WHERE user_id = $1 AND status = 'closed' AND closed_at >= CURRENT_DATE`,
    [userId]
  ).catch(() => ({ realized_pnl: 0 }));

  const portfolio = {
    equity,
    open_positions: brokerPositions.length,
    exposure_pct: equity
      ? +(((brokerPositions.reduce((s, p) => s + (p.market_value || 0), 0)) / equity) * 100).toFixed(1)
      : null,
    todays_realized_pnl: parseFloat(realized_pnl) || 0,
  };

  // Universe: watchlist ∪ symbols with open positions, so a de-watchlisted
  // symbol keeps being managed until its position closes.
  const universe = [...new Set([...settings.symbols, ...positionsBySymbol.keys()])];
  const mode = resolveAiMode(settings.ai_mode);

  // Tiered mode: cheap screening pass picks candidates. Open positions always
  // pass. Screening failure fails OPEN to analysis (never to trading).
  let toAnalyze = universe;
  if (mode.screeningModel && universe.length) {
    try {
      const { summaries, unscreenable } = await buildScreeningSummaries(universe, positionsBySymbol);
      const picked = new Set(await screenSymbols(summaries, mode));
      toAnalyze = universe.filter(
        (s) => positionsBySymbol.has(s) || picked.has(s) || unscreenable.includes(s)
      );
      for (const symbol of universe.filter((s) => !toAnalyze.includes(s))) {
        await logRun({ userId, symbol, timeframe: '-', action: 'screened_out' });
      }
    } catch (err) {
      logger.warn({ userId, err: err.message }, 'Screening failed — analyzing all symbols');
    }
  }

  for (const symbol of toAnalyze) {
    try {
      await processSymbol({
        userId, userEmail, settings, conn, adapter, mode, symbol,
        position: positionsBySymbol.get(symbol) || null,
        portfolio, entryBlocked, equity,
      });
    } catch (err) {
      logger.error({ userId, symbol, err: err.message }, 'Auto-trading cycle error');
      await logRun({ userId, symbol, timeframe: settings.timeframes.join('+'), action: 'error', errorMessage: err.message });
    }
  }
}

// ── Per-symbol decision + guardrail gate ──────────────────────────────────────

async function processSymbol({
  userId, userEmail, settings, conn, adapter, mode, symbol, position, portfolio, entryBlocked, equity,
}) {
  const timeframeLabel = settings.timeframes.join('+');
  const context = await buildMarketContext({
    symbol, timeframes: settings.timeframes, contextProfile: mode.contextProfile, position, portfolio,
  });
  const decision = await generateDecision(userId, context, mode);

  const base = {
    userId, symbol, timeframe: timeframeLabel,
    decision: decision.action, confidence: decision.confidence,
    signalId: decision.id, reasoning: decision.reasoning,
    actionDetail: { decision },
  };

  if (decision.action === 'hold') return logRun({ ...base, action: 'hold' });

  if (decision.confidence < settings.min_confidence) {
    return logRun({ ...base, action: 'skipped_low_confidence' });
  }

  if (!riskManagement.checkAuthority(settings.authority, decision.action)) {
    return logRun({ ...base, action: 'skipped_authority' });
  }

  if (ENTRY_ACTIONS.includes(decision.action)) {
    if (entryBlocked) return logRun({ ...base, action: entryBlocked });

    const cooldownRow = await db.oneOrNone(
      `SELECT id FROM auto_trading_runs
       WHERE user_id = $1 AND symbol = $2 AND action IN ('order_placed', 'position_added')
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 minute' * $3
       ORDER BY created_at DESC LIMIT 1`,
      [userId, symbol, settings.cooldown_minutes]
    );
    if (cooldownRow) return logRun({ ...base, action: 'skipped_cooldown' });

    const { count } = await db.one(
      `SELECT COUNT(*) FROM auto_trading_runs
       WHERE user_id = $1 AND action IN ('order_placed', 'position_added') AND created_at >= CURRENT_DATE`,
      [userId]
    );
    if (parseInt(count, 10) >= settings.max_trades_per_day) {
      return logRun({ ...base, action: 'skipped_daily_trade_limit' });
    }

    // The engine never reverses in one step: with any position open,
    // open_long/open_short is a conflict (Claude should 'close' first).
    if ((decision.action === 'open_long' || decision.action === 'open_short') && position) {
      return logRun({ ...base, action: 'skipped_existing_position' });
    }
  } else if (!position) {
    return logRun({ ...base, action: 'error', errorMessage: 'position action without an open position' });
  }

  const result = await executeDecision({
    db, adapter, conn, userId, userEmail, settings, symbol, position, decision, equity,
  });
  return logRun({
    ...base,
    action: result.action,
    orderId: result.orderId,
    errorMessage: result.errorMessage,
    actionDetail: { decision, execution: result.detail || null },
  });
}

// ── Run logging ───────────────────────────────────────────────────────────────

async function logRun({ userId, symbol, timeframe, decision, confidence, action, signalId, orderId, reasoning, errorMessage, actionDetail }) {
  await db.none(
    `INSERT INTO auto_trading_runs
       (user_id, symbol, timeframe, decision, confidence, action, signal_id, order_id, reasoning, error_message, action_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [userId, symbol, timeframe, decision || null, confidence ?? null, action,
     signalId || null, orderId || null, reasoning || null, errorMessage || null,
     actionDetail ? JSON.stringify(actionDetail) : null]
  ).catch((err) => logger.error({ err: err.message }, 'Failed to log auto-trading run'));
}

// ── Cron job ─────────────────────────────────────────────────────────────────

function startAutoTradingCron() {
  // Staggered off the broker-sync `*/15 * * * *` schedule
  cron.schedule('7,22,37,52 * * * *', async () => {
    logger.info('Cron: starting auto-trading cycle');
    await runAutoTradingCycle().catch((err) => logger.error({ err }, 'Auto-trading cycle failed'));
  });

  logger.info('Auto-trading cron job started');
}

module.exports = {
  runAutoTradingCycle, startAutoTradingCron, getAutoTradingSettings, DEFAULT_SETTINGS,
  runForUser, processSymbol, checkCircuitBreaker, CIRCUIT_BREAKER_ERROR_THRESHOLD,
};
```

Note the `logRun` insert: `action` is parameter index 5 (0-based) — the phase8 tests assert on `params[5]`.

- [ ] **Step 4: Update the v1 phase7 test file**

In `backend/src/__tests__/phase7/autoTradingEngine.test.js`: delete the `describe('analyzeAndTrade', ...)` block and any import of `analyzeAndTrade` (the function no longer exists). Keep `getAutoTradingSettings`, `runAutoTradingCycle`, and circuit-breaker tests, but note `getAutoTradingSettings(null)` now returns the enlarged defaults — update its equality assertion from `toEqual(DEFAULT_SETTINGS)` (still fine, both sides grew) and fix any test that asserts exact insert parameter lists for `logRun` (one more `action_detail` param).

- [ ] **Step 5: Run the engine tests (old and new)**

Run: `cd backend && npx jest autoTradingEngine --coverage=false`
Expected: PASS — phase7 (trimmed) and phase8 both green

- [ ] **Step 6: Run the full backend suite to catch regressions**

Run: `cd backend && npm test`
Expected: PASS (routes tests may need the same defaults-grew treatment if they assert exact settings shapes — fix them the same way)

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/autoTradingEngine.js backend/src/__tests__/phase8/autoTradingEngineV2.test.js backend/src/__tests__/phase7/autoTradingEngine.test.js
git commit -m "feat: engine v2 orchestration - fused per-symbol decisions with position management"
```

---

### Task 10: API routes — settings validation + benchmark endpoint

**Files:**
- Modify: `backend/src/routes/autoTrading.js`
- Test: `backend/src/__tests__/phase8/autoTradingRoutesV2.test.js`

**Interfaces:**
- Consumes: `AI_MODE_NAMES` (Task 3), `getAutoTradingSettings` (Task 9), `benchmark_snapshots` table (Task 1).
- Produces: `PUT /api/auto-trading/settings` accepts `ai_mode` and `authority` (deep-merged); `GET /api/auto-trading/benchmark → { series: [{ date, engine_equity, watchlist_value }] }`. Task 12/13 frontend consumes both.

- [ ] **Step 1: Write the failing tests**

Follow the existing pattern in `backend/src/__tests__/phase7/autoTrading.routes.test.js` (Express app with mocked `db` and mocked `authenticate` middleware — copy its top-of-file setup verbatim, it mocks `../../config/database` and `../../middleware/auth`):

```js
// backend/src/__tests__/phase8/autoTradingRoutesV2.test.js
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
  mockDb.oneOrNone.mockResolvedValue(null);
  mockDb.manyOrNone.mockResolvedValue([]);
});

describe('PUT /api/auto-trading/settings (v2 fields)', () => {
  test('accepts a valid ai_mode and authority and deep-merges authority', async () => {
    mockDb.one
      .mockResolvedValueOnce({ preferences: { auto_trading: { authority: { close: true } } } }) // current read
      .mockResolvedValueOnce({ preferences: { auto_trading: { ai_mode: 'tiered', authority: { close: true, adjust_stop: true, partial_exit: false, add: false } } } }); // update returning
    const res = await request(app).put('/api/auto-trading/settings')
      .send({ ai_mode: 'tiered', authority: { adjust_stop: true } });
    expect(res.status).toBe(200);
    expect(res.body.settings.ai_mode).toBe('tiered');
    expect(res.body.settings.authority).toEqual({ close: true, adjust_stop: true, partial_exit: false, add: false });
  });

  test('rejects an unknown ai_mode', async () => {
    const res = await request(app).put('/api/auto-trading/settings').send({ ai_mode: 'turbo' });
    expect(res.status).toBe(400);
  });

  test('rejects non-boolean authority values', async () => {
    const res = await request(app).put('/api/auto-trading/settings').send({ authority: { close: 'yes' } });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auto-trading/benchmark', () => {
  test('returns the two series', async () => {
    mockDb.manyOrNone.mockResolvedValue([
      { snapshot_date: '2026-07-08', engine_equity: '100100.00', watchlist_value: '100050.00' },
    ]);
    const res = await request(app).get('/api/auto-trading/benchmark');
    expect(res.status).toBe(200);
    expect(res.body.series).toEqual([
      { date: '2026-07-08', engine_equity: 100100, watchlist_value: 100050 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/autoTradingRoutesV2.test.js --coverage=false`
Expected: FAIL — 400s missing / benchmark 404

- [ ] **Step 3: Implement in `backend/src/routes/autoTrading.js`**

Add to the requires at the top:

```js
const { AI_MODE_NAMES } = require('../services/aiModes');
```

Add these validators to the `PUT /settings` validation array (after the `max_trades_per_day` line):

```js
  body('ai_mode').optional().isIn(AI_MODE_NAMES),
  body('authority').optional().isObject(),
  body('authority.close').optional().isBoolean().toBoolean(),
  body('authority.adjust_stop').optional().isBoolean().toBoolean(),
  body('authority.partial_exit').optional().isBoolean().toBoolean(),
  body('authority.add').optional().isBoolean().toBoolean(),
```

Note: `express-validator`'s `isBoolean()` on a JSON `true` passes, but on `'yes'` fails — that's the 400 the test expects. Replace the merge line inside the handler:

```js
  const merged = { ...current, ...req.body };
```

with a deep merge for authority:

```js
  const merged = {
    ...current,
    ...req.body,
    authority: { ...current.authority, ...(req.body.authority || {}) },
  };
```

In `GET /api/auto-trading/activity`, add `action_detail` to the SELECT column list so the frontend can render timeframe-alignment chips:

```js
    `SELECT id, symbol, timeframe, decision, confidence, action, signal_id, order_id, reasoning, error_message, action_detail, created_at
     FROM auto_trading_runs WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
```

Add the benchmark endpoint before `module.exports`:

```js
// ── GET /api/auto-trading/benchmark ───────────────────────────────────────────
// Engine equity vs equal-weight buy-and-hold of the watchlist (frozen at
// first snapshot). Rendered as the paper-trial comparison chart.

router.get('/benchmark', authenticate, asyncHandler(async (req, res) => {
  const rows = await db.manyOrNone(
    `SELECT snapshot_date, engine_equity, watchlist_value
     FROM benchmark_snapshots WHERE user_id = $1
     ORDER BY snapshot_date ASC`,
    [req.user.id]
  );
  res.json({
    series: rows.map((r) => ({
      date: r.snapshot_date instanceof Date ? r.snapshot_date.toISOString().slice(0, 10) : String(r.snapshot_date),
      engine_equity: parseFloat(r.engine_equity),
      watchlist_value: parseFloat(r.watchlist_value),
    })),
  });
}));
```

- [ ] **Step 4: Run tests to verify they pass, plus phase7 route tests**

Run: `cd backend && npx jest autoTrading --coverage=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/autoTrading.js backend/src/__tests__/phase8/autoTradingRoutesV2.test.js
git commit -m "feat: ai_mode/authority settings validation + benchmark endpoint"
```

---

### Task 11: Benchmark snapshot service + cron

**Files:**
- Create: `backend/src/services/benchmarkService.js`
- Modify: `backend/src/server.js` (start the cron next to `startAutoTradingCron()`, around lines 13–14 and 170–171)
- Test: `backend/src/__tests__/phase8/benchmarkService.test.js`

**Interfaces:**
- Consumes: `getAutoTradingSettings` (Task 9), `getCurrentPrice(symbol) → { price, ... }` from `./marketData`, adapter `getAccountInfo`, `benchmark_snapshots` table (Task 1).
- Produces: `snapshotUser(user)`, `runBenchmarkSnapshots()`, `startBenchmarkCron()` (daily `10 21 * * 1-5` UTC — after US market close, weekdays).

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/__tests__/phase8/benchmarkService.test.js
const mockDb = { one: jest.fn(), oneOrNone: jest.fn(), manyOrNone: jest.fn(), none: jest.fn() };
const mockDecryptCredentials = jest.fn();
const mockGetAdapter = jest.fn();
const mockGetCurrentPrice = jest.fn();

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/brokerEncryption', () => ({ decryptCredentials: mockDecryptCredentials }));
jest.mock('../../services/brokers/index', () => ({ getAdapter: mockGetAdapter }));
jest.mock('../../services/marketData', () => ({ getCurrentPrice: mockGetCurrentPrice }));

const { snapshotUser } = require('../../services/benchmarkService');

const USER = {
  id: 'user-1',
  email: 'u@x.com',
  preferences: { auto_trading: { enabled: true, broker_connection_id: 'conn-1', symbols: ['AAPL', 'MSFT'] } },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.oneOrNone.mockImplementation((sql) => {
    if (/broker_connections/.test(sql)) {
      return Promise.resolve({ id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc' });
    }
    return Promise.resolve(null); // no prior snapshot
  });
  mockDb.none.mockResolvedValue(undefined);
  mockDecryptCredentials.mockReturnValue({ api_key: 'k' });
  mockGetAdapter.mockReturnValue({
    getAccountInfo: jest.fn().mockResolvedValue({ funds: { equity: 100000 } }),
  });
  mockGetCurrentPrice.mockImplementation((symbol) =>
    Promise.resolve({ price: symbol === 'AAPL' ? 200 : 400 })
  );
});

describe('snapshotUser', () => {
  test('first snapshot freezes an equal-weight composition and inserts', async () => {
    await snapshotUser(USER);
    const insert = mockDb.none.mock.calls.find(([sql]) => /INSERT INTO benchmark_snapshots/.test(sql));
    expect(insert).toBeTruthy();
    const [, params] = insert;
    // equity 100000 → 50000 per symbol → 250 AAPL @200, 125 MSFT @400
    const composition = JSON.parse(params[3]);
    expect(composition).toEqual({ AAPL: 250, MSFT: 125 });
    expect(params[1]).toBe(100000);           // engine_equity
    expect(params[2]).toBeCloseTo(100000, 0); // watchlist_value on day one ≈ equity
  });

  test('later snapshots reuse the frozen composition', async () => {
    mockDb.oneOrNone.mockImplementation((sql) => {
      if (/broker_connections/.test(sql)) {
        return Promise.resolve({ id: 'conn-1', broker_id: 'alpaca', credentials_encrypted: 'enc' });
      }
      return Promise.resolve({ watchlist_composition: { AAPL: 250, MSFT: 125 } });
    });
    mockGetCurrentPrice.mockImplementation((symbol) =>
      Promise.resolve({ price: symbol === 'AAPL' ? 210 : 390 })
    );
    await snapshotUser(USER);
    const [, params] = mockDb.none.mock.calls.find(([sql]) => /INSERT INTO benchmark_snapshots/.test(sql));
    // 250*210 + 125*390 = 52500 + 48750 = 101250
    expect(params[2]).toBeCloseTo(101250, 0);
    expect(JSON.parse(params[3])).toEqual({ AAPL: 250, MSFT: 125 });
  });

  test('skips users without auto-trading enabled', async () => {
    await snapshotUser({ id: 'u2', preferences: {} });
    expect(mockDb.none).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest src/__tests__/phase8/benchmarkService.test.js --coverage=false`
Expected: FAIL — `Cannot find module '../../services/benchmarkService'`

- [ ] **Step 3: Implement**

```js
// backend/src/services/benchmarkService.js
// Daily snapshot of engine equity vs an equal-weight buy-and-hold of the
// watchlist, frozen at the first snapshot. Success criterion for the paper
// trial: the engine line beats the buy-and-hold line.

const cron = require('node-cron');
const { db } = require('../config/database');
const { decryptCredentials } = require('../config/brokerEncryption');
const { getAdapter } = require('./brokers/index');
const { getCurrentPrice } = require('./marketData');
const { getAutoTradingSettings } = require('./autoTradingEngine');
const logger = require('../config/logger');

async function snapshotUser(user) {
  const settings = getAutoTradingSettings(user.preferences);
  if (!settings.enabled || !settings.broker_connection_id || !settings.symbols.length) return;

  const conn = await db.oneOrNone(
    `SELECT id, broker_id, credentials_encrypted FROM broker_connections
     WHERE id = $1 AND user_id = $2 AND status = 'connected'`,
    [settings.broker_connection_id, user.id]
  );
  if (!conn) return;

  const adapter = getAdapter(conn.broker_id, decryptCredentials(conn.credentials_encrypted));
  const account = await adapter.getAccountInfo();
  const equity = account?.funds?.equity;
  if (!equity) return;

  const first = await db.oneOrNone(
    `SELECT watchlist_composition FROM benchmark_snapshots
     WHERE user_id = $1 ORDER BY snapshot_date ASC LIMIT 1`,
    [user.id]
  );

  let composition = first?.watchlist_composition || null;
  const symbols = composition ? Object.keys(composition) : settings.symbols;

  const prices = {};
  for (const symbol of symbols) {
    prices[symbol] = (await getCurrentPrice(symbol)).price;
  }

  if (!composition) {
    // Freeze an equal-dollar-weight buy-and-hold of today's watchlist at
    // today's prices. Fractional shares are fine — it's a benchmark.
    composition = {};
    const perSymbol = equity / symbols.length;
    for (const symbol of symbols) {
      composition[symbol] = +(perSymbol / prices[symbol]).toFixed(6);
    }
  }

  const watchlistValue = Object.entries(composition)
    .reduce((sum, [symbol, qty]) => sum + qty * (prices[symbol] || 0), 0);

  await db.none(
    `INSERT INTO benchmark_snapshots (user_id, engine_equity, watchlist_value, watchlist_composition, snapshot_date)
     VALUES ($1, $2, $3, $4, CURRENT_DATE)
     ON CONFLICT (user_id, snapshot_date) DO NOTHING`,
    [user.id, equity, +watchlistValue.toFixed(2), JSON.stringify(composition)]
  );
  logger.info({ userId: user.id, equity, watchlistValue: +watchlistValue.toFixed(2) }, 'Benchmark snapshot recorded');
}

async function runBenchmarkSnapshots() {
  const users = await db.manyOrNone(
    `SELECT id, email, preferences FROM users WHERE preferences->'auto_trading'->>'enabled' = 'true'`
  );
  await Promise.allSettled(users.map((u) =>
    snapshotUser(u).catch((err) =>
      logger.error({ userId: u.id, err: err.message }, 'Benchmark snapshot failed')
    )
  ));
}

function startBenchmarkCron() {
  // Weekdays 21:10 UTC — after the US market close, staggered off other crons.
  cron.schedule('10 21 * * 1-5', async () => {
    logger.info('Cron: benchmark snapshots');
    await runBenchmarkSnapshots().catch((err) => logger.error({ err }, 'Benchmark snapshot run failed'));
  });
  logger.info('Benchmark cron job started');
}

module.exports = { snapshotUser, runBenchmarkSnapshots, startBenchmarkCron };
```

- [ ] **Step 4: Wire the cron into `backend/src/server.js`**

Next to the existing require (line ~14):

```js
const { startBenchmarkCron } = require('./services/benchmarkService');
```

Next to the existing startup calls (line ~171, after `startAutoTradingCron();`):

```js
    startBenchmarkCron();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/__tests__/phase8/benchmarkService.test.js --coverage=false && npm test`
Expected: PASS, full suite green

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/benchmarkService.js backend/src/server.js backend/src/__tests__/phase8/benchmarkService.test.js
git commit -m "feat: daily benchmark snapshots - engine equity vs frozen buy-and-hold"
```

---

### Task 12: Frontend — types, Collapsible primitive, AI mode + authority settings UI

**Files:**
- Modify: `frontend/src/types/api.ts` (extend `AutoTradingSettings` at line ~440, add `BenchmarkPoint`)
- Create: `frontend/src/components/ui/collapsible.tsx`
- Modify: `frontend/src/pages/trading/AutoTradingPage.tsx`
- Test: `frontend/src/pages/trading/AutoTradingPage.test.tsx` (extend; also update its `baseSettings` fixture)

**Interfaces:**
- Consumes: `PUT /api/auto-trading/settings` with `ai_mode`/`authority` (Task 10).
- Produces: `Collapsible` component (`{ summary: string, children }`, native `<details>`), `AutoTradingAuthority` and `BenchmarkPoint` types consumed by Task 13.

- [ ] **Step 1: Extend the types in `frontend/src/types/api.ts`**

Replace the `AutoTradingSettings` interface with:

```ts
export type AiMode = 'minimize' | 'balanced' | 'tiered' | 'max'

export interface AutoTradingAuthority {
  close: boolean
  adjust_stop: boolean
  partial_exit: boolean
  add: boolean
}

export interface AutoTradingSettings {
  enabled: boolean
  broker_connection_id: string | null
  symbols: string[]
  timeframes: string[]
  min_confidence: number
  risk_per_trade_pct: number
  max_daily_loss_pct: number
  cooldown_minutes: number
  max_trades_per_day: number
  ai_mode: AiMode
  authority: AutoTradingAuthority
}

export interface BenchmarkPoint {
  date: string
  engine_equity: number
  watchlist_value: number
}
```

Also extend `AutoTradingRun` (line ~452) with the audit payload the activity endpoint now returns:

```ts
export interface AutoTradingRun {
  id: string
  symbol: string
  timeframe: string
  decision: string | null
  confidence: number | null
  action: string
  signal_id: string | null
  order_id: string | null
  reasoning: string | null
  error_message: string | null
  action_detail: {
    decision?: { timeframe_alignment?: Record<string, string>; invalidation?: string | null }
    execution?: Record<string, unknown> | null
  } | null
  created_at: string
}
```

(Update the test fixtures that construct `AutoTradingRun` objects to include `action_detail: null`.)

- [ ] **Step 2: Create the Collapsible primitive**

```tsx
// frontend/src/components/ui/collapsible.tsx
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export function Collapsible({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="mt-1.5 rounded-md border border-border bg-card/50 p-2.5 text-xs leading-relaxed text-muted">
        {children}
      </div>
    </details>
  )
}
```

- [ ] **Step 3: Write the failing tests (append to the existing describe in `AutoTradingPage.test.tsx`; first update its `baseSettings` fixture to include the new fields)**

Update the fixture:

```ts
const baseSettings: AutoTradingSettings = {
  enabled: true,
  broker_connection_id: 'conn-1',
  symbols: ['AAPL'],
  timeframes: ['1h'],
  min_confidence: 70,
  risk_per_trade_pct: 0.01,
  max_daily_loss_pct: 0.03,
  cooldown_minutes: 60,
  max_trades_per_day: 5,
  ai_mode: 'balanced',
  authority: { close: true, adjust_stop: false, partial_exit: false, add: false },
}
```

Also extend the test file's `mockApiGet` so `'/auto-trading/benchmark'` returns `{ data: { series: [] } }` (Task 13's chart query fires on render once implemented; harmless before then).

New tests:

```tsx
test('renders the four AI mode options with balanced selected', async () => {
  mockApiGet()
  renderPage()
  await waitFor(() => expect(screen.getByText('AI mode')).toBeInTheDocument())
  const balanced = screen.getByRole('radio', { name: /balanced/i })
  expect(balanced).toBeChecked()
  expect(screen.getByRole('radio', { name: /minimize/i })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /tiered/i })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /max/i })).toBeInTheDocument()
})

test('selecting an AI mode updates the form and saves it', async () => {
  mockApiGet()
  ;(api.put as Mock).mockResolvedValue({ data: { settings: { ...baseSettings, ai_mode: 'tiered' } } })
  renderPage()
  await waitFor(() => expect(screen.getByText('AI mode')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('radio', { name: /tiered/i }))
  fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/auto-trading/settings', expect.objectContaining({ ai_mode: 'tiered' })),
  )
})

test('renders authority toggles with close on by default', async () => {
  mockApiGet()
  renderPage()
  await waitFor(() => expect(screen.getByText('Engine authority')).toBeInTheDocument())
  expect(screen.getByRole('switch', { name: /close positions/i })).toBeChecked()
  expect(screen.getByRole('switch', { name: /adjust stops/i })).not.toBeChecked()
  expect(screen.getByRole('switch', { name: /partial exits/i })).not.toBeChecked()
  expect(screen.getByRole('switch', { name: /add to positions/i })).not.toBeChecked()
})

test('toggling an authority switch is included in the save payload', async () => {
  mockApiGet()
  ;(api.put as Mock).mockResolvedValue({ data: { settings: baseSettings } })
  renderPage()
  await waitFor(() => expect(screen.getByText('Engine authority')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('switch', { name: /adjust stops/i }))
  fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith(
      '/auto-trading/settings',
      expect.objectContaining({ authority: expect.objectContaining({ adjust_stop: true }) }),
    ),
  )
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/trading/AutoTradingPage.test.tsx`
Expected: FAIL — `AI mode` not found

- [ ] **Step 5: Implement in `AutoTradingPage.tsx`**

Add imports:

```tsx
import { Collapsible } from '@/components/ui/collapsible'
import type { AiMode } from '@/types/api'
```

Add the mode/authority descriptors after the `TIMEFRAMES` constant:

```tsx
const AI_MODES: { value: AiMode; label: string; blurb: string; description: string }[] = [
  {
    value: 'minimize',
    label: 'Minimize cost',
    blurb: 'Cheapest — small model, trimmed context.',
    description:
      'Uses the small model with a trimmed context (2 timeframes, fewer candles, no news). Rough cost: cents per day for a small watchlist. Best for proving the loop works; expect noticeably weaker analysis and more conservative decisions.',
  },
  {
    value: 'balanced',
    label: 'Balanced (default)',
    blurb: 'Strong model with prompt caching on every decision.',
    description:
      'Every symbol gets a full fused multi-timeframe analysis from the standard decision model, with prompt caching to keep repeat costs down. Rough cost: tens of dollars per month at a 5–10 symbol watchlist on 15-minute cycles. The recommended starting point.',
  },
  {
    value: 'tiered',
    label: 'Tiered by stakes',
    blurb: 'Cheap screening pass; the strong model only sees candidates.',
    description:
      'A small model first screens the watchlist for actionable setups; only screened-in symbols (and every open position) get the full decision model. Best cost/quality ratio for larger watchlists — but adds a screening step that can miss subtle setups.',
  },
  {
    value: 'max',
    label: 'Max intelligence',
    blurb: 'Top model with extended thinking on every decision.',
    description:
      'The top model reasons step-by-step (extended thinking) over the full context for every decision. Highest analysis quality and the highest cost — can reach hundreds of dollars per month on large watchlists with frequent cycles. Use when decision quality matters more than spend.',
  },
]

const AUTHORITY_OPTIONS: { key: keyof AutoTradingSettings['authority']; label: string; description: string }[] = [
  {
    key: 'close',
    label: 'Close positions',
    description:
      'The engine may fully close a position when its analysis turns against it — the core of autonomous risk control. On by default. With this off, exits rely entirely on the stop-loss/take-profit placed at entry.',
  },
  {
    key: 'adjust_stop',
    label: 'Adjust stops',
    description:
      'The engine may tighten a stop-loss (e.g. trail it to breakeven) as a trade evolves. It can never widen a stop — that is enforced in code, not left to the AI.',
  },
  {
    key: 'partial_exit',
    label: 'Partial exits',
    description:
      'The engine may scale out — sell part of a winner to lock in profit while the rest runs. Note: the remaining shares are unprotected until the next cycle re-evaluates them.',
  },
  {
    key: 'add',
    label: 'Add to positions',
    description:
      'The engine may add to an existing position (pyramid into winners). Highest risk of the four — most autonomous engines exclude this. Each add is sized by the same risk rules as a new entry.',
  },
]
```

Insert this JSX inside the Settings `CardContent`, after the timeframes block and before the watchlist block:

```tsx
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">AI mode</label>
            <div className="flex flex-col gap-2">
              {AI_MODES.map((mode) => (
                <div key={mode.value} className="rounded-lg border border-border p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="ai_mode"
                      aria-label={mode.label}
                      className="mt-1 accent-primary"
                      checked={form.ai_mode === mode.value}
                      onChange={() => setForm({ ...form, ai_mode: mode.value })}
                    />
                    <span>
                      <span className="block text-sm font-medium text-foreground">{mode.label}</span>
                      <span className="block text-xs text-muted">{mode.blurb}</span>
                    </span>
                  </label>
                  <div className="mt-2 pl-7">
                    <Collapsible summary="Details & cost notes">{mode.description}</Collapsible>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Engine authority</label>
            <p className="text-xs text-muted">
              What the engine may do to open positions without asking you. Entries are governed by the enable switch above.
            </p>
            <div className="flex flex-col gap-2">
              {AUTHORITY_OPTIONS.map((opt) => (
                <div key={opt.key} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-foreground">{opt.label}</span>
                    <Switch
                      aria-label={opt.label}
                      checked={form.authority[opt.key]}
                      onCheckedChange={(checked) =>
                        setForm({ ...form, authority: { ...form.authority, [opt.key]: checked } })
                      }
                    />
                  </div>
                  <div className="mt-2">
                    <Collapsible summary="What this allows">{opt.description}</Collapsible>
                  </div>
                </div>
              ))}
            </div>
          </div>
```

If the existing `Switch` primitive doesn't forward `aria-label`, add it to the component's props pass-through (check `frontend/src/components/ui/switch.tsx` — Radix `Switch.Root` forwards ARIA attributes automatically).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/trading/AutoTradingPage.test.tsx`
Expected: PASS (existing + 4 new)

- [ ] **Step 7: Lint + typecheck + commit**

```bash
cd frontend && npm run lint && npx tsc --noEmit
git add frontend/src/types/api.ts frontend/src/components/ui/collapsible.tsx frontend/src/pages/trading/AutoTradingPage.tsx frontend/src/pages/trading/AutoTradingPage.test.tsx
git commit -m "feat: AI mode + engine authority settings UI with collapsible descriptions"
```

---

### Task 13: Frontend — activity feed action types + benchmark chart

**Files:**
- Create: `frontend/src/components/BenchmarkChart.tsx`
- Modify: `frontend/src/pages/trading/AutoTradingPage.tsx`
- Test: `frontend/src/pages/trading/AutoTradingPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `GET /api/auto-trading/benchmark → { series: BenchmarkPoint[] }` (Task 10), new run action strings (Task 9), `lightweight-charts` v5 (`createChart`, `LineSeries` — same import style as `frontend/src/components/PriceChart.tsx`).

- [ ] **Step 1: Write the failing tests (append to `AutoTradingPage.test.tsx`)**

```tsx
test('renders new action types with variants and timeframe alignment source', async () => {
  const runs: AutoTradingRun[] = [
    {
      id: 'r1', symbol: 'AAPL', timeframe: '1h+4h', decision: 'close', confidence: 88,
      action: 'position_closed', signal_id: null, order_id: null,
      reasoning: 'trend broke', error_message: null, created_at: '2026-07-08T12:00:00.000Z',
      action_detail: { decision: { timeframe_alignment: { '1h': 'bearish', '4h': 'neutral' } } },
    },
    {
      id: 'r2', symbol: 'TSLA', timeframe: '1h+4h', decision: 'adjust_stop', confidence: 75,
      action: 'needs_attention', signal_id: null, order_id: null,
      reasoning: null, error_message: 'close failed after cancel', created_at: '2026-07-08T12:01:00.000Z',
      action_detail: null,
    },
  ]
  mockApiGet({ runs })
  renderPage()
  await waitFor(() => expect(screen.getByText('position_closed')).toBeInTheDocument())
  expect(screen.getByText('needs_attention')).toBeInTheDocument()
  expect(screen.getByText('1h bearish')).toBeInTheDocument()
  expect(screen.getByText('4h neutral')).toBeInTheDocument()
})

test('renders the benchmark card when series data exists', async () => {
  mockApiGet()
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/auto-trading/benchmark') {
      return Promise.resolve({
        data: { series: [{ date: '2026-07-08', engine_equity: 100100, watchlist_value: 100050 }] },
      })
    }
    if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings: baseSettings } })
    if (url === '/auto-trading/status') return Promise.resolve({ data: baseStatus })
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections } })
    if (url === '/auto-trading/activity') return Promise.resolve({ data: { runs: [], total: 0 } })
    return Promise.resolve({ data: {} })
  })
  renderPage()
  await waitFor(() => expect(screen.getByText(/Engine vs buy-and-hold/i)).toBeInTheDocument())
})
```

Note: `lightweight-charts` needs a canvas; in jsdom, mock it at the top of the test file:

```tsx
vi.mock('@/components/BenchmarkChart', () => ({
  BenchmarkChart: () => <div data-testid="benchmark-chart" />,
}))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/trading/AutoTradingPage.test.tsx`
Expected: FAIL — `Engine vs buy-and-hold` not found

- [ ] **Step 3: Implement `BenchmarkChart`**

```tsx
// frontend/src/components/BenchmarkChart.tsx
import { useEffect, useRef } from 'react'
import { ColorType, LineSeries, createChart, type UTCTimestamp } from 'lightweight-charts'
import type { BenchmarkPoint } from '@/types/api'

export function BenchmarkChart({ series }: { series: BenchmarkPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#262932' },
        horzLines: { color: '#262932' },
      },
      width: containerRef.current.clientWidth,
      height: 280,
      timeScale: { timeVisible: false },
    })

    const toPoint = (date: string, value: number) => ({
      time: (new Date(`${date}T00:00:00Z`).getTime() / 1000) as UTCTimestamp,
      value,
    })

    const engine = chart.addSeries(LineSeries, { color: '#22c55e', lineWidth: 2, title: 'Engine' })
    engine.setData(series.map((p) => toPoint(p.date, p.engine_equity)))

    const benchmark = chart.addSeries(LineSeries, { color: '#9ca3af', lineWidth: 2, title: 'Buy & hold' })
    benchmark.setData(series.map((p) => toPoint(p.date, p.watchlist_value)))

    chart.timeScale().fitContent()

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [series])

  return <div ref={containerRef} className="w-full" />
}
```

- [ ] **Step 4: Wire into `AutoTradingPage.tsx`**

Add imports:

```tsx
import { BenchmarkChart } from '@/components/BenchmarkChart'
import type { BenchmarkPoint } from '@/types/api'
```

Add the query next to `activityQuery`:

```tsx
  const benchmarkQuery = useQuery({
    queryKey: ['auto-trading-benchmark'],
    queryFn: async () => (await api.get<{ series: BenchmarkPoint[] }>('/auto-trading/benchmark')).data.series,
  })
```

Extend the `actionVariant` map (replace the existing constant):

```tsx
const actionVariant: Record<string, 'success' | 'danger' | 'muted' | 'default'> = {
  order_placed: 'success',
  position_added: 'success',
  position_closed: 'default',
  partial_exit: 'default',
  stop_adjusted: 'default',
  error: 'danger',
  needs_attention: 'danger',
  auto_disabled_errors: 'danger',
}
```

In the activity table, render timeframe-alignment chips under the reasoning (replace the existing reasoning `TableCell`):

```tsx
                    <TableCell className="max-w-xs text-muted">
                      <span className="block truncate" title={run.reasoning || run.error_message || ''}>
                        {run.reasoning || run.error_message || '—'}
                      </span>
                      {run.action_detail?.decision?.timeframe_alignment && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(run.action_detail.decision.timeframe_alignment).map(([tf, bias]) => (
                            <Badge key={tf} variant={bias === 'bullish' ? 'success' : bias === 'bearish' ? 'danger' : 'muted'}>
                              {tf} {bias}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
```

Add the benchmark card between the Settings card and the Activity card:

```tsx
      {(benchmarkQuery.data?.length ?? 0) > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Engine vs buy-and-hold</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted">
              Daily engine equity against an equal-weight buy-and-hold of your watchlist, frozen at the first snapshot.
            </p>
            <BenchmarkChart series={benchmarkQuery.data ?? []} />
          </CardContent>
        </Card>
      )}
      {benchmarkQuery.data?.length === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Engine vs buy-and-hold</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">First benchmark snapshot recorded — the comparison chart appears after the second daily snapshot.</p>
          </CardContent>
        </Card>
      )}
```

(The second test in Step 1 renders with exactly one point — it asserts the card title exists, which the single-snapshot branch also renders. Both branches satisfy it.)

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `cd frontend && npx vitest run src/pages/trading/AutoTradingPage.test.tsx && npm run lint && npx tsc --noEmit`
Expected: PASS, clean

- [ ] **Step 6: Full-suite sanity check (backend + frontend)**

Run: `cd backend && npm test && cd ../frontend && npx vitest run`
Expected: everything green

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/BenchmarkChart.tsx frontend/src/pages/trading/AutoTradingPage.tsx frontend/src/pages/trading/AutoTradingPage.test.tsx
git commit -m "feat: activity feed v2 actions + engine-vs-benchmark chart"
```

---

## Post-plan verification (manual, after all tasks)

1. `docker compose up -d postgres redis`, apply the Task 1 migration, `cd backend && npm run dev`, `cd frontend && npm run dev`.
2. On the Auto Trading page: pick an AI mode, flip authority toggles, save — confirm `PUT /api/auto-trading/settings` round-trips both.
3. With an Alpaca **paper** connection and `AUTO_TRADING_ENABLED` unset, trigger one cycle manually (`node -e "require('./src/services/autoTradingEngine').runAutoTradingCycle()"` from `backend/`) and confirm run rows appear with `action_detail` populated.
4. Trigger one benchmark snapshot the same way (`runBenchmarkSnapshots`) and confirm the endpoint returns a series.
5. The 2–4 week paper trial then runs operationally — engine line vs buy-and-hold line on the page is the success criterion.
