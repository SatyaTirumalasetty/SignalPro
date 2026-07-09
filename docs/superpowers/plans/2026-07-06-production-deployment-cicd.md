# Production Deployment & CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SignalPro to production — React frontend on Vercel at `bearbull.app`, Express backend (with the 24/7 auto-trading engine) on AWS ECS Fargate at `api.bearbull.app` — with a test-gated GitHub Actions pipeline that deploys on every green push to `master`.

**Architecture:** Single Fargate task runs the existing Docker image behind an ALB (ACM cert, `api.bearbull.app` alias) with RDS Postgres (`db.t4g.micro`) provisioned as a Copilot environment addon. Secrets flow through the existing `AWS_SECRETS_MANAGER_SECRET_ID` loader from one secret, `signalpro/prod/app`. GitHub Actions deploys via an OIDC-assumed IAM role; the frontend deploys to Vercel via CLI only after the backend deploy and smoke test succeed.

**Tech Stack:** AWS Copilot CLI, ECS Fargate, RDS Postgres 16, Route53, ACM, Secrets Manager, GitHub Actions (OIDC), Vercel CLI, Node 20, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-06-production-deployment-cicd-design.md`

**Deviation from spec (intentional):** the deploy logic lives as a `deploy` job appended to the existing `.github/workflows/ci.yml` with `needs: [test, docker-build, sonarqube, dependency-scan]`, instead of a separate `deploy.yml` triggered by `workflow_run`. Same gating guarantee, none of `workflow_run`'s context quirks. The existing `ci.yml` already provides the test/Sonar/Trivy gates the spec asks for.

## Global Constraints

- Trading mode: **Alpaca paper only** in production — `ALPACA_FORCE_PAPER=true` (Task 5) must be set in the prod service manifest.
- AWS region: **us-east-1** (matches the secrets loader default in `backend/src/config/secrets.js:20`).
- One Fargate task: 0.25 vCPU / 512 MB (`cpu: 256`, `memory: 512`), `count: 1`.
- No Redis/ElastiCache in prod: do NOT set `REDIS_URL` in the manifest (backend falls back to in-memory rate limiting).
- Node 20 in CI (matches existing workflows and Dockerfile `node:20-alpine`).
- Domain: `bearbull.app` (site), `api.bearbull.app` (API). App secret name: `signalpro/prod/app`. Copilot app: `signalpro`, env: `prod`, service: `api`.
- Backend health endpoint: `GET /api/health` (already exists, `backend/src/server.js:59`).
- Tasks 1–6 are code and can run on any machine. Tasks 7–11 need AWS/Vercel/GitHub credentials and the registered domain — they are operator tasks executed from a terminal, still with exact commands.

---

### Task 1: Consolidate SQL files into `backend/database/`

The SQL sources are split: `database/init.sql` (file, canonical schema) + `database/migrations/001…005_*.sql` at repo root, and `backend/database/migrations/2026*_*.sql`. Worse, `backend/database/init.sql` is an **empty directory** (docker-compose bind-mount artifact) squatting on the path the migration runner needs. Consolidate everything under `backend/database/` so the Docker image can carry one SQL tree.

**Files:**
- Delete: `backend/database/init.sql` (empty directory)
- Move: `database/init.sql` → `backend/database/init.sql`
- Move: `database/migrations/*.sql` (5 files) → `backend/database/migrations/`
- Delete: `database/` (now empty)

**Interfaces:**
- Produces: `backend/database/init.sql` (baseline schema file) and `backend/database/migrations/` containing, in lexicographic (= execution) order: `001_phase1_additions.sql`, `002_phase2_additions.sql`, `003_users_role_column.sql`, `004_support_ticket_assigned_to_fk.sql`, `005_orders_risk_columns.sql`, `20260613000000_add_order_sl_tp_columns.sql`, `20260614000000_add_auto_trading.sql`. (`0…` sorts before `2…`, so numbered legacy migrations run first — correct.)

- [ ] **Step 1: Remove the empty directory and move the files**

```bash
rmdir backend/database/init.sql
git mv database/init.sql backend/database/init.sql
git mv database/migrations/001_phase1_additions.sql backend/database/migrations/
git mv database/migrations/002_phase2_additions.sql backend/database/migrations/
git mv database/migrations/003_users_role_column.sql backend/database/migrations/
git mv database/migrations/004_support_ticket_assigned_to_fk.sql backend/database/migrations/
git mv database/migrations/005_orders_risk_columns.sql backend/database/migrations/
```

If `rmdir` fails because the directory is not empty, STOP and inspect — do not force-delete.

- [ ] **Step 2: Verify layout and that nothing references the old paths**

```bash
ls backend/database backend/database/migrations
grep -rn "database/init.sql\|database/migrations" --include="*.yml" --include="*.yaml" --include="*.js" --include="*.json" --include="*.md" . | grep -v node_modules | grep -v backend/database
```

Expected: `backend/database` shows `init.sql` (a FILE) + `migrations/` with 7 files. The grep may match `docker-compose.yml` (`./backend/database/init.sql` — already correct, previously mounted the empty dir, now mounts the real file) and docs like `DEPLOYMENT_GUIDE.md` referencing `../database/init.sql` — update any doc lines found to `backend/database/init.sql`.

- [ ] **Step 3: Confirm the compose Postgres still initializes**

```bash
docker compose up -d postgres && sleep 15 && docker compose exec postgres psql -U signalpro -d signalpro -c "\dt" && docker compose down
```

Expected: table list including `users` (init.sql now actually loads — previously the bind mount was an empty dir). If Docker isn't running locally, skip with a note in the commit message.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: consolidate SQL schema and migrations under backend/database"
```

---

### Task 2: Migration runner (`npm run migrate` currently points at a file that doesn't exist)

`backend/package.json` declares `"migrate": "node src/database/migrate.js"` but the file was never created; migrations have been applied by hand. Create the runner with a `schema_migrations` ledger.

**Files:**
- Create: `backend/src/database/migrate.js`
- Test: `backend/src/__tests__/phase8/migrate.test.js`

**Interfaces:**
- Consumes: `db` from `backend/src/config/database.js` (pg-promise: `none`, `oneOrNone`, `manyOrNone`, `tx`), SQL tree from Task 1.
- Produces: `runMigrations(): Promise<void>` exported from `backend/src/database/migrate.js` (Task 3 calls it at startup). Also runnable directly: `node src/database/migrate.js`.

Behavior contract:
1. Ensure `schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())` exists.
2. Fresh DB (`users` table absent): run `init.sql` in a transaction, record version `000_init`.
3. Existing hand-managed DB (`users` present, ledger empty): record `000_init` + every migration filename WITHOUT executing them (baseline assumption: hand-applied DB is current). This protects dev databases.
4. Apply each unapplied `backend/database/migrations/*.sql` in sorted order, each in its own transaction, recording its filename.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase8/migrate.test.js`:

```js
const path = require('path');

const executed = [];
const t = { none: jest.fn((sql, params) => { executed.push({ sql, params }); return Promise.resolve(); }) };
const mockDb = {
  none: jest.fn(() => Promise.resolve()),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  tx: jest.fn((fn) => fn(t)),
};

jest.mock('../../config/database', () => ({ db: mockDb }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { runMigrations } = require('../../database/migrate');

beforeEach(() => {
  executed.length = 0;
  jest.clearAllMocks();
});

describe('runMigrations', () => {
  test('fresh database: applies init.sql then every migration file in order', async () => {
    mockDb.manyOrNone.mockResolvedValue([]); // empty ledger
    mockDb.oneOrNone.mockResolvedValue({ reg: null }); // users table absent

    await runMigrations();

    // First tx applies init.sql and records 000_init
    const recorded = executed
      .filter((e) => /INSERT INTO schema_migrations/.test(e.sql))
      .map((e) => e.params[0]);
    expect(recorded[0]).toBe('000_init');
    expect(recorded).toContain('001_phase1_additions.sql');
    expect(recorded).toContain('20260614000000_add_auto_trading.sql');
    // Order: 001... before 2026...
    expect(recorded.indexOf('001_phase1_additions.sql'))
      .toBeLessThan(recorded.indexOf('20260613000000_add_order_sl_tp_columns.sql'));
  });

  test('existing hand-managed database: baselines ledger without executing SQL files', async () => {
    mockDb.manyOrNone.mockResolvedValue([]); // empty ledger
    mockDb.oneOrNone.mockResolvedValue({ reg: 'users' }); // users table exists

    await runMigrations();

    const inserts = executed.filter((e) => /INSERT INTO schema_migrations/.test(e.sql));
    const nonInserts = executed.filter((e) => !/INSERT INTO schema_migrations/.test(e.sql));
    expect(inserts.length).toBeGreaterThanOrEqual(8); // 000_init + 7 files
    expect(nonInserts).toHaveLength(0); // no migration SQL actually ran
  });

  test('already-applied migrations are skipped', async () => {
    mockDb.manyOrNone.mockResolvedValue([
      { version: '000_init' },
      { version: '001_phase1_additions.sql' },
      { version: '002_phase2_additions.sql' },
      { version: '003_users_role_column.sql' },
      { version: '004_support_ticket_assigned_to_fk.sql' },
      { version: '005_orders_risk_columns.sql' },
      { version: '20260613000000_add_order_sl_tp_columns.sql' },
      { version: '20260614000000_add_auto_trading.sql' },
    ]);
    mockDb.oneOrNone.mockResolvedValue({ reg: 'users' });

    await runMigrations();

    expect(mockDb.tx).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest src/__tests__/phase8/migrate.test.js
```

Expected: FAIL — `Cannot find module '../../database/migrate'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/database/migrate.js`:

```js
const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');
const logger = require('../config/logger');

// In the repo this resolves to backend/database; in the Docker image, /app/database.
const SQL_ROOT = path.join(__dirname, '..', '..', 'database');

async function tableExists(name) {
  const row = await db.oneOrNone('SELECT to_regclass($1) AS reg', [`public.${name}`]);
  return Boolean(row && row.reg);
}

function listMigrationFiles() {
  const dir = path.join(SQL_ROOT, 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function runMigrations() {
  await db.none(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const rows = await db.manyOrNone('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const files = listMigrationFiles();
  const usersExists = await tableExists('users');

  if (usersExists && applied.size === 0) {
    // Hand-managed database predating the runner: record everything as
    // applied without executing, so existing dev DBs are never re-migrated.
    await db.tx(async (tx) => {
      await tx.none('INSERT INTO schema_migrations (version) VALUES ($1)', ['000_init']);
      for (const f of files) {
        await tx.none('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
      }
    });
    logger.info('Baselined existing database; no migrations executed');
    return;
  }

  if (!usersExists && !applied.has('000_init')) {
    const initSql = fs.readFileSync(path.join(SQL_ROOT, 'init.sql'), 'utf8');
    await db.tx(async (tx) => {
      await tx.none(initSql);
      await tx.none('INSERT INTO schema_migrations (version) VALUES ($1)', ['000_init']);
    });
    applied.add('000_init');
    logger.info('Applied baseline init.sql');
  }

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(SQL_ROOT, 'migrations', f), 'utf8');
    await db.tx(async (tx) => {
      await tx.none(sql);
      await tx.none('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
    });
    logger.info({ migration: f }, 'Applied migration');
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migrations complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'Migration failed');
      process.exit(1);
    });
}
```

Note the third test expects `mockDb.tx` NOT to be called when everything is applied — the skip loop must check `applied.has(f)` before opening a transaction (the code above does).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npx jest src/__tests__/phase8/migrate.test.js
```

Expected: 3 passed.

- [ ] **Step 5: Run the full backend suite to check for regressions**

```bash
cd backend && npm test -- --forceExit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/database/migrate.js backend/src/__tests__/phase8/migrate.test.js
git commit -m "feat: add SQL migration runner with schema_migrations ledger"
```

---

### Task 3: Run migrations at startup + ship SQL files in the Docker image

**Files:**
- Modify: `backend/src/server.js:165-172` (the `start()` function)
- Modify: `Dockerfile` (runner stage — SQL tree is currently NOT copied into the image)
- Test: `backend/src/__tests__/phase8/startupMigrations.test.js`

**Interfaces:**
- Consumes: `runMigrations()` from Task 2.
- Produces: startup behavior gated by env var `RUN_MIGRATIONS_ON_START === 'true'` (set only in the prod manifest, Task 8; local dev and tests are unaffected).

- [ ] **Step 1: Modify `start()` in `backend/src/server.js`**

Change:

```js
async function start() {
  try {
    await initializeDatabase();
    logger.info('✅ Database initialized');

    startCronJobs();
```

to:

```js
async function start() {
  try {
    await initializeDatabase();
    logger.info('✅ Database initialized');

    if (process.env.RUN_MIGRATIONS_ON_START === 'true') {
      const { runMigrations } = require('./database/migrate');
      await runMigrations();
      logger.info('✅ Migrations up to date');
    }

    startCronJobs();
```

If migrations throw, the existing `catch` calls `process.exit(1)` — the task never passes its ALB health check and the ECS deployment circuit breaker rolls back, which is exactly the spec's failure mode.

- [ ] **Step 2: Add the SQL tree to the Docker image**

In `Dockerfile`, in the `runner` stage, after `COPY backend/src ./src` add:

```dockerfile
COPY backend/database ./database
```

- [ ] **Step 3: Write a regression test for the gate**

Create `backend/src/__tests__/phase8/startupMigrations.test.js` (same `jest.doMock` + `jest.resetModules` + microtask-flush pattern as `backend/src/__tests__/phase6/index.test.js`):

```js
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

// server.js runs start() on require; mock every module with side effects so
// requiring it is cheap, and listen on an ephemeral port.
function loadServer() {
  jest.doMock('../../config/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
  jest.doMock('../../config/database', () => ({
    db: {},
    pgp: {},
    initializeDatabase: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../services/brokerSync', () => ({ startCronJobs: jest.fn() }));
  jest.doMock('../../services/autoTradingEngine', () => ({ startAutoTradingCron: jest.fn() }));
  jest.doMock('../../services/alpacaMarketData', () => ({
    isConfigured: () => false,
    getLatestQuotes: jest.fn(),
  }));
  jest.doMock('../../database/migrate', () => ({
    runMigrations: jest.fn().mockResolvedValue(undefined),
  }));
  const { runMigrations } = require('../../database/migrate');
  const { startCronJobs } = require('../../services/brokerSync');
  const { server } = require('../../server');
  return { runMigrations, startCronJobs, server };
}

describe('startup migrations gate', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.PORT = '0';
  });
  afterEach(() => {
    delete process.env.RUN_MIGRATIONS_ON_START;
    delete process.env.PORT;
  });

  test('does not run migrations when RUN_MIGRATIONS_ON_START is unset', async () => {
    delete process.env.RUN_MIGRATIONS_ON_START;
    const { runMigrations, startCronJobs, server } = loadServer();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(runMigrations).not.toHaveBeenCalled();
    expect(startCronJobs).toHaveBeenCalled(); // startup still proceeds
    server.close();
  });

  test('runs migrations before starting cron jobs when flag is true', async () => {
    process.env.RUN_MIGRATIONS_ON_START = 'true';
    const { runMigrations, startCronJobs, server } = loadServer();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(startCronJobs).toHaveBeenCalled();
    expect(runMigrations.mock.invocationCallOrder[0])
      .toBeLessThan(startCronJobs.mock.invocationCallOrder[0]);
    server.close();
  });
});
```

If requiring `server.js` with these mocks fails because a route module needs another env var at load time, add that env var in `beforeEach` (mirroring whatever `phase7/autoTrading.routes.test.js` sets) rather than adding more mocks.

- [ ] **Step 4: Run the tests**

```bash
cd backend && npx jest src/__tests__/phase8/ && npm test -- --forceExit
```

Expected: new tests pass, no regressions.

- [ ] **Step 5: Verify the image builds and contains the SQL**

```bash
docker build -t signalpro-backend:migtest --target runner .
docker run --rm --entrypoint ls signalpro-backend:migtest database database/migrations
```

Expected: `init.sql`, `migrations/` with 7 `.sql` files. (Skip if Docker unavailable locally; CI's docker-build job covers the build.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/server.js Dockerfile backend/src/__tests__/phase8/startupMigrations.test.js
git commit -m "feat: run migrations at startup behind RUN_MIGRATIONS_ON_START and ship SQL in image"
```

---

### Task 4: Multi-origin CORS for bearbull.app + Vercel previews

CORS is currently a single origin from `FRONTEND_URL` (`backend/src/server.js:40-45`). Production needs `https://bearbull.app`, `https://www.bearbull.app`, and (optionally) Vercel preview URLs.

**Files:**
- Modify: `backend/src/config/security.js` (add `buildCorsOrigin`)
- Modify: `backend/src/server.js:40-45`
- Test: `backend/src/__tests__/phase8/cors.test.js`

**Interfaces:**
- Produces: `buildCorsOrigin(): (origin, callback) => void` exported from `backend/src/config/security.js`, driven by env vars: `FRONTEND_URL` (single, back-compat, default `http://localhost:5173`), `FRONTEND_URLS` (comma-separated additions), `CORS_ALLOW_VERCEL_PREVIEWS` (`'true'` enables `https://<anything>.vercel.app`).

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase8/cors.test.js`:

```js
describe('buildCorsOrigin', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; jest.resetModules(); });

  function allow(origin) {
    const { buildCorsOrigin } = require('../../config/security');
    let result;
    buildCorsOrigin()(origin, (err, ok) => { result = ok; });
    return result;
  }

  test('defaults to localhost dev origin', () => {
    delete process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URLS;
    expect(allow('http://localhost:5173')).toBe(true);
    expect(allow('https://evil.example.com')).toBe(false);
  });

  test('allows every origin listed in FRONTEND_URLS', () => {
    process.env.FRONTEND_URLS = 'https://bearbull.app, https://www.bearbull.app';
    expect(allow('https://bearbull.app')).toBe(true);
    expect(allow('https://www.bearbull.app')).toBe(true);
    expect(allow('https://bearbull.app.evil.com')).toBe(false);
  });

  test('vercel previews only when explicitly enabled', () => {
    expect(allow('https://signalpro-abc123-satya.vercel.app')).toBe(false);
    process.env.CORS_ALLOW_VERCEL_PREVIEWS = 'true';
    expect(allow('https://signalpro-abc123-satya.vercel.app')).toBe(true);
    expect(allow('https://fake.vercel.app.evil.com')).toBe(false);
  });

  test('requests with no Origin header (curl, health checks) pass', () => {
    expect(allow(undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest src/__tests__/phase8/cors.test.js
```

Expected: FAIL — `buildCorsOrigin is not a function`.

- [ ] **Step 3: Implement in `backend/src/config/security.js`**

Add to the module (keep existing exports; read env inside the returned closure's builder so tests can vary env per call):

```js
function buildCorsOrigin() {
  const explicit = new Set(
    [process.env.FRONTEND_URL || 'http://localhost:5173']
      .concat((process.env.FRONTEND_URLS || '').split(','))
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const allowVercelPreviews = process.env.CORS_ALLOW_VERCEL_PREVIEWS === 'true';
  const vercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

  return (origin, callback) => {
    if (!origin) return callback(null, true);
    if (explicit.has(origin)) return callback(null, true);
    if (allowVercelPreviews && vercelPreview.test(origin)) return callback(null, true);
    return callback(null, false);
  };
}
```

Add `buildCorsOrigin` to the module's exports. Then in `backend/src/server.js` replace:

```js
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
```

with:

```js
const { helmetOptions, buildCorsOrigin } = require('./config/security');
// ... (replace the existing helmetOptions-only destructure at line 10)

app.use(cors({
  origin: buildCorsOrigin(),
```

(keep `credentials`, `methods`, `allowedHeaders` unchanged).

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest src/__tests__/phase8/cors.test.js && npm test -- --forceExit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/security.js backend/src/server.js backend/src/__tests__/phase8/cors.test.js
git commit -m "feat: multi-origin CORS allowlist with optional Vercel preview support"
```

---

### Task 5: Global paper-trading enforcement (`ALPACA_FORCE_PAPER`)

Paper vs live is currently a per-broker-connection flag (`credentials.paper`, `backend/src/services/brokers/adapters/alpaca.js:7`). The spec requires production to be paper-only regardless of what any user's connection says.

**Files:**
- Modify: `backend/src/services/brokers/adapters/alpaca.js:5-18`
- Test: `backend/src/__tests__/phase8/forcePaper.test.js`

**Interfaces:**
- Produces: when env `ALPACA_FORCE_PAPER === 'true'`, every `AlpacaAdapter` uses `https://paper-api.alpaca.markets` and reports `paper: true`, even if constructed with `paper: false`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/phase8/forcePaper.test.js`:

```js
jest.mock('axios', () => ({ create: jest.fn(() => ({ get: jest.fn(), post: jest.fn() })) }));
const axios = require('axios');
const AlpacaAdapter = require('../../services/brokers/adapters/alpaca');

describe('ALPACA_FORCE_PAPER', () => {
  const saved = process.env.ALPACA_FORCE_PAPER;
  afterEach(() => {
    process.env.ALPACA_FORCE_PAPER = saved;
    if (saved === undefined) delete process.env.ALPACA_FORCE_PAPER;
    jest.clearAllMocks();
  });

  test('live credentials are forced onto the paper API when flag is true', () => {
    process.env.ALPACA_FORCE_PAPER = 'true';
    const adapter = new AlpacaAdapter({ api_key: 'k', api_secret: 's', paper: false });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://paper-api.alpaca.markets' })
    );
    expect(adapter.credentials.paper).toBe(true);
  });

  test('live credentials reach the live API when flag is unset', () => {
    delete process.env.ALPACA_FORCE_PAPER;
    new AlpacaAdapter({ api_key: 'k', api_secret: 's', paper: false });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.alpaca.markets' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest src/__tests__/phase8/forcePaper.test.js
```

Expected: first test FAILS (adapter hits the live URL).

- [ ] **Step 3: Implement in the adapter constructor**

In `backend/src/services/brokers/adapters/alpaca.js`, change the constructor's opening to:

```js
  constructor(credentials) {
    if (process.env.ALPACA_FORCE_PAPER === 'true' && !credentials.paper) {
      credentials = { ...credentials, paper: true };
    }
    super('alpaca', credentials);
    const base = credentials.paper
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';
```

(rest unchanged — `this.credentials` is set by `super`, so `validateCredentials()`'s `paper: this.credentials.paper` reports the forced value.)

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest src/__tests__/phase8/forcePaper.test.js && npx jest src/__tests__/phase2/adapters.test.js && npm test -- --forceExit
```

Expected: all pass (phase2 adapter tests confirm no regression for the unforced path).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/brokers/adapters/alpaca.js backend/src/__tests__/phase8/forcePaper.test.js
git commit -m "feat: ALPACA_FORCE_PAPER env flag forces all Alpaca connections onto the paper API"
```

---

### Task 6: CI gates — add frontend lint + production build

The existing `test` job in `.github/workflows/ci.yml` runs frontend tests but never lints the frontend or proves `tsc -b && vite build` succeeds. A type error would today reach the deploy step before failing.

**Files:**
- Modify: `.github/workflows/ci.yml` (test job, after the "Run frontend tests" step at line 89-91)

**Interfaces:**
- Produces: `test` job that fails on frontend lint/type/build errors. Task 11's deploy job `needs` this job.

- [ ] **Step 1: Add steps to the `test` job**

After the "Run frontend tests" step, add:

```yaml
      - name: Lint frontend
        working-directory: frontend
        run: npm run lint

      - name: Build frontend
        working-directory: frontend
        run: npm run build
        env:
          VITE_API_BASE_URL: https://api.bearbull.app
```

- [ ] **Step 2: Verify locally that both commands pass**

```bash
cd frontend && npm run lint && npm run build
```

Expected: exit 0 for both. If lint fails on existing code, fix the violations (do not loosen rules) before committing.

- [ ] **Step 3: Commit and verify on GitHub**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: gate on frontend lint and production build"
git push origin master
gh run watch --exit-status || gh run view --log-failed
```

Expected: CI green. (Sonar/Trivy jobs need their existing secrets — if they fail for infra reasons unrelated to this change, note it and continue.)

---

### Task 7: Operator prerequisites — domain, Route53, app secret (manual, one-time)

No repo changes. Everything Tasks 8–11 depend on. Requires: AWS CLI authenticated as an admin in the target account, the `bearbull.app` registration completed by the owner.

**Interfaces:**
- Produces: Route53 public hosted zone for `bearbull.app`; Secrets Manager secret `signalpro/prod/app` (region us-east-1) containing every runtime secret.

- [ ] **Step 1: Register `bearbull.app`** (owner action — GoDaddy/Namecheap/Route53; verified available 2026-07-06)

- [ ] **Step 2: Create the hosted zone and delegate DNS**

```bash
aws route53 create-hosted-zone --name bearbull.app --caller-reference "signalpro-$(date +%s)"
aws route53 list-hosted-zones-by-name --dns-name bearbull.app --query "HostedZones[0].Id" --output text
aws route53 get-hosted-zone --id <ZONE_ID> --query "DelegationSet.NameServers"
```

Set the four returned NS values as the domain's nameservers at the registrar (skip if registered directly in Route53 — the zone already exists; reuse it and skip `create-hosted-zone`). Verify propagation before Task 8:

```bash
nslookup -type=NS bearbull.app
```

Expected: the Route53 nameservers.

- [ ] **Step 3: Create the app secret**

Generate strong values first (`openssl rand -hex 32` for JWTs; ENCRYPTION_KEY must be exactly 32 chars, ENCRYPTION_IV exactly 16 chars — `openssl rand -hex 16` and `openssl rand -hex 8`). Then:

```bash
aws secretsmanager create-secret --region us-east-1 --name signalpro/prod/app --secret-string '{
  "JWT_SECRET": "<64-char-random>",
  "JWT_REFRESH_SECRET": "<64-char-random>",
  "ENCRYPTION_KEY": "<exactly-32-chars>",
  "ENCRYPTION_IV": "<exactly-16-chars>",
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "ALPACA_API_KEY": "<alpaca PAPER key id>",
  "ALPACA_API_SECRET": "<alpaca PAPER secret>",
  "ALPACA_DATA_FEED": "iex",
  "SMTP_HOST": "<smtp host>",
  "SMTP_PORT": "587",
  "SMTP_USER": "<smtp user>",
  "SMTP_PASSWORD": "<smtp password>",
  "FROM_EMAIL": "alerts@bearbull.app",
  "DB_USER": "signalpro",
  "DB_NAME": "signalpro",
  "DB_PORT": "5432",
  "DB_PASSWORD": "<strong-random-no-quotes-slashes-or-@>"
}'
```

`DB_HOST` is added in Task 8 Step 5 once RDS exists. The env var names match what the code reads (`backend/src/services/alpacaMarketData.js`, `emailService.js`, `config/database.js`, `config/brokerEncryption.js`); the loader in `config/secrets.js` copies each key into `process.env` at boot. Use PAPER Alpaca keys only.

- [ ] **Step 4: Verify**

```bash
aws secretsmanager get-secret-value --region us-east-1 --secret-id signalpro/prod/app --query SecretString --output text | python -m json.tool > /dev/null && echo OK
```

Expected: `OK` (valid JSON).

---

### Task 8: Copilot infrastructure + first backend deploy

**Files:**
- Create: `copilot/api/manifest.yml` (replace the `copilot svc init` skeleton with the content below)
- Create: `copilot/environments/prod/addons/db.yml`
- Create: `copilot/api/addons/app-secret-policy.yml`
- (Generated by CLI, commit as-is: `copilot/environments/prod/manifest.yml`, `copilot/.workspace`)

**Interfaces:**
- Consumes: hosted zone + secret from Task 7; image/Dockerfile from Task 3; env flags from Tasks 3–5.
- Produces: live `https://api.bearbull.app/api/health`; Copilot workspace that Task 11's `copilot deploy --name api --env prod` uses.

- [ ] **Step 1: Install Copilot and initialize app + env + service (no deploy yet)**

```bash
# Windows: download copilot-windows.exe from https://github.com/aws/copilot-cli/releases/latest and put it on PATH as copilot.exe
copilot app init signalpro --domain bearbull.app
copilot env init --name prod --profile default --default-config
copilot svc init --name api --svc-type "Load Balanced Web Service" --dockerfile ./Dockerfile
```

- [ ] **Step 2: Write the RDS environment addon**

Create `copilot/environments/prod/addons/db.yml`:

```yaml
Parameters:
  App:
    Type: String
  Env:
    Type: String

Resources:
  DBSubnetGroup:
    Type: AWS::RDS::DBSubnetGroup
    Properties:
      DBSubnetGroupDescription: SignalPro prod database subnets
      SubnetIds: !Split [',', Fn::ImportValue: !Sub '${App}-${Env}-PrivateSubnets']

  DBSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Postgres access from the Copilot environment
      VpcId:
        Fn::ImportValue: !Sub '${App}-${Env}-VpcId'
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 5432
          ToPort: 5432
          SourceSecurityGroupId:
            Fn::ImportValue: !Sub '${App}-${Env}-EnvironmentSecurityGroup'

  Database:
    Type: AWS::RDS::DBInstance
    DeletionPolicy: Snapshot
    UpdateReplacePolicy: Snapshot
    Properties:
      Engine: postgres
      EngineVersion: '16'
      DBInstanceClass: db.t4g.micro
      AllocatedStorage: '20'
      StorageType: gp3
      DBName: signalpro
      MasterUsername: signalpro
      MasterUserPassword: '{{resolve:secretsmanager:signalpro/prod/app:SecretString:DB_PASSWORD}}'
      DBSubnetGroupName: !Ref DBSubnetGroup
      VPCSecurityGroups:
        - !Ref DBSecurityGroup
      PubliclyAccessible: false
      MultiAZ: false
      BackupRetentionPeriod: 7
      DeleteAutomatedBackups: false

Outputs:
  DbEndpoint:
    Description: RDS endpoint hostname (copy into the signalpro/prod/app secret as DB_HOST)
    Value: !GetAtt Database.Endpoint.Address
```

- [ ] **Step 3: Write the service manifest**

Replace the generated `copilot/api/manifest.yml` with:

```yaml
name: api
type: Load Balanced Web Service

http:
  path: '/'
  alias: api.bearbull.app
  healthcheck:
    path: '/api/health'
    healthy_threshold: 2
    unhealthy_threshold: 3
    interval: 15s
    timeout: 5s
    grace_period: 180s   # cold start runs migrations before listening

image:
  build:
    dockerfile: Dockerfile
    context: .
  port: 3001

cpu: 256
memory: 512
count: 1
exec: true

network:
  vpc:
    placement: 'public'   # public subnets avoid ~$32/mo NAT gateway; SG still restricts ingress to the ALB

variables:
  NODE_ENV: production
  PORT: '3001'
  RUN_MIGRATIONS_ON_START: 'true'
  AWS_SECRETS_MANAGER_SECRET_ID: signalpro/prod/app
  ALPACA_FORCE_PAPER: 'true'
  FRONTEND_URL: https://bearbull.app
  FRONTEND_URLS: https://bearbull.app,https://www.bearbull.app
  CORS_ALLOW_VERCEL_PREVIEWS: 'true'
```

- [ ] **Step 4: Write the task-role secret policy addon**

Create `copilot/api/addons/app-secret-policy.yml`:

```yaml
Parameters:
  App:
    Type: String
  Env:
    Type: String
  Name:
    Type: String

Resources:
  AppSecretAccessPolicy:
    Type: AWS::IAM::ManagedPolicy
    Properties:
      PolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Action: secretsmanager:GetSecretValue
            Resource: !Sub 'arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:signalpro/prod/app-*'

Outputs:
  AppSecretAccessPolicyArn:
    Description: Attached to the task role by Copilot
    Value: !Ref AppSecretAccessPolicy
```

- [ ] **Step 5: Deploy the environment (VPC + ALB cert + RDS), then record DB_HOST**

```bash
copilot env deploy --name prod
aws rds describe-db-instances --region us-east-1 \
  --query "DBInstances[?DBName=='signalpro'].Endpoint.Address" --output text
```

Merge `"DB_HOST": "<endpoint>"` into the secret (fetch current JSON, add the key, put back):

```bash
aws secretsmanager get-secret-value --region us-east-1 --secret-id signalpro/prod/app --query SecretString --output text > /tmp/app-secret.json
# edit /tmp/app-secret.json to add "DB_HOST", then:
aws secretsmanager put-secret-value --region us-east-1 --secret-id signalpro/prod/app --secret-string file:///tmp/app-secret.json
rm /tmp/app-secret.json
```

Expected: env deploy completes (~15 min, RDS is slow); endpoint printed.

- [ ] **Step 6: Deploy the service and smoke test**

```bash
copilot svc deploy --name api --env prod
curl -fsS https://api.bearbull.app/api/health
```

Expected: `{"status":"ok",...}`. Debug helpers if not: `copilot svc logs --name api --env prod --follow` (look for "Loaded secrets", "Applied baseline init.sql", the startup banner) and `copilot svc status`.

- [ ] **Step 7: Commit the Copilot workspace**

```bash
git add copilot/
git commit -m "feat: AWS Copilot infrastructure - Fargate service, RDS addon, secret access policy"
```

---

### Task 9: GitHub OIDC deploy role

**Files:**
- Create: `deployment/github-oidc-role.yml`

**Interfaces:**
- Produces: IAM role ARN stored as GitHub secret `AWS_DEPLOY_ROLE_ARN`; Task 11's workflow assumes it via `aws-actions/configure-aws-credentials`.

- [ ] **Step 1: Write the CloudFormation template**

Create `deployment/github-oidc-role.yml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: GitHub Actions OIDC deploy role for SignalPro (master branch only)

Parameters:
  GitHubRepo:
    Type: String
    Default: SatyaTirumalasetty/SignalPro

Resources:
  GitHubOIDCProvider:
    Type: AWS::IAM::OIDCProvider
    Properties:
      Url: https://token.actions.githubusercontent.com
      ClientIdList:
        - sts.amazonaws.com
      ThumbprintList:
        - 6938fd4d98bab03faadb97b34396831e3780aea1

  DeployRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: signalpro-github-deploy
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Federated: !Ref GitHubOIDCProvider
            Action: sts:AssumeRoleWithWebIdentity
            Condition:
              StringEquals:
                token.actions.githubusercontent.com:aud: sts.amazonaws.com
                token.actions.githubusercontent.com:sub: !Sub 'repo:${GitHubRepo}:ref:refs/heads/master'
      # Copilot drives CloudFormation/ECS/ECR/IAM-pass-role; scoping this
      # tightly is a follow-up — solo project accepts admin on a role that
      # only master-branch CI of this one repo can assume.
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/AdministratorAccess

Outputs:
  DeployRoleArn:
    Value: !GetAtt DeployRole.Arn
```

If the account already has a `token.actions.githubusercontent.com` OIDC provider, delete the `GitHubOIDCProvider` resource and set `Federated` to the existing provider ARN (`aws iam list-open-id-connect-providers`).

- [ ] **Step 2: Deploy the stack and capture the ARN**

```bash
aws cloudformation deploy --region us-east-1 --template-file deployment/github-oidc-role.yml \
  --stack-name signalpro-github-oidc --capabilities CAPABILITY_NAMED_IAM
aws cloudformation describe-stacks --region us-east-1 --stack-name signalpro-github-oidc \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text
```

- [ ] **Step 3: Store the GitHub secret**

```bash
gh secret set AWS_DEPLOY_ROLE_ARN --repo SatyaTirumalasetty/SignalPro --body "<role arn from step 2>"
```

- [ ] **Step 4: Commit**

```bash
git add deployment/github-oidc-role.yml
git commit -m "feat: GitHub OIDC deploy role CloudFormation template"
```

---

### Task 10: Vercel project — SPA config, domains, env, disabled prod auto-deploy

**Files:**
- Create: `frontend/vercel.json`

**Interfaces:**
- Consumes: live API from Task 8 (previews will call it).
- Produces: Vercel project serving `bearbull.app` with PR previews on; production deploys ONLY via CLI (Task 11). GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

- [ ] **Step 1: Create `frontend/vercel.json`**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "git": {
    "deploymentEnabled": {
      "master": false
    }
  }
}
```

The rewrite makes deep links (e.g. `/dashboard`) work with react-router; Vercel serves real files (assets) before rewrites. `master: false` disables Git-triggered production deploys while keeping PR previews.

- [ ] **Step 2: Create and link the Vercel project**

In the Vercel dashboard: **Add New Project** → import `SatyaTirumalasetty/SignalPro` → set **Root Directory** to `frontend` (framework auto-detects Vite) → deploy once (throwaway). Then set the environment variable — Project → Settings → Environment Variables:

- `VITE_API_BASE_URL` = `https://api.bearbull.app` for **Production** and **Preview**.

Locally capture the IDs and store GitHub secrets:

```bash
cd frontend && npx vercel link   # choose the project just created; writes .vercel/project.json
cat .vercel/project.json         # contains orgId and projectId
gh secret set VERCEL_ORG_ID --repo SatyaTirumalasetty/SignalPro --body "<orgId>"
gh secret set VERCEL_PROJECT_ID --repo SatyaTirumalasetty/SignalPro --body "<projectId>"
gh secret set VERCEL_TOKEN --repo SatyaTirumalasetty/SignalPro --body "<token from vercel.com/account/tokens>"
```

`.vercel/` is gitignored by `vercel link` automatically — verify `git status` shows no `.vercel` files staged.

- [ ] **Step 3: Attach the domains and DNS**

In Vercel: Project → Settings → Domains → add `bearbull.app` and `www.bearbull.app` (redirect www → apex). Vercel shows required records; create them in Route53:

```bash
# A record: bearbull.app → 76.76.21.21 ; CNAME: www.bearbull.app → cname.vercel-dns.com
# (use the exact values Vercel displays — they occasionally differ)
aws route53 change-resource-record-sets --hosted-zone-id <ZONE_ID> --change-batch '{
  "Changes": [
    {"Action":"UPSERT","ResourceRecordSet":{"Name":"bearbull.app","Type":"A","TTL":300,"ResourceRecords":[{"Value":"76.76.21.21"}]}},
    {"Action":"UPSERT","ResourceRecordSet":{"Name":"www.bearbull.app","Type":"CNAME","TTL":300,"ResourceRecords":[{"Value":"cname.vercel-dns.com"}]}}
  ]
}'
```

Wait for Vercel's domain panel to show both as valid.

- [ ] **Step 4: Commit**

```bash
git add frontend/vercel.json
git commit -m "feat: Vercel SPA config with prod auto-deploy disabled"
```

---

### Task 11: The deploy job — gated pipeline to production

**Files:**
- Modify: `.github/workflows/ci.yml` (append the `deploy` job)

**Interfaces:**
- Consumes: GitHub secrets `AWS_DEPLOY_ROLE_ARN` (Task 9), `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` (Task 10); Copilot workspace (Task 8).
- Produces: push to `master` → tests/Sonar/Trivy → backend deploy → smoke test → frontend prod deploy.

- [ ] **Step 1: Append the deploy job to `.github/workflows/ci.yml`**

```yaml
  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: [test, docker-build, sonarqube, dependency-scan]
    if: github.event_name == 'push' && github.ref == 'refs/heads/master'
    concurrency:
      group: production-deploy
      cancel-in-progress: false
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1

      - name: Install Copilot CLI
        run: |
          curl -fsSL -o copilot https://github.com/aws/copilot-cli/releases/latest/download/copilot-linux
          chmod +x copilot && sudo mv copilot /usr/local/bin/copilot
          copilot --version

      - name: Deploy backend (build, push, ECS rollout)
        run: copilot deploy --app signalpro --name api --env prod

      - name: Smoke test API
        run: |
          curl -fsS --retry 10 --retry-delay 15 --retry-all-errors \
            https://api.bearbull.app/api/health
          echo "API healthy"

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Deploy frontend to Vercel production
        working-directory: frontend
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
        run: |
          npm install -g vercel@latest
          vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
          vercel build --prod --token="$VERCEL_TOKEN"
          vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
```

Ordering is the gate: a failed backend deploy or smoke test stops the job before the frontend step, so the live site never points at a dead API. ECS rollback on failed health checks comes free from Copilot's deployment circuit breaker.

- [ ] **Step 2: Push and watch the full pipeline**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add gated production deploy job (ECS via Copilot, then Vercel)"
git push origin master
gh run watch --exit-status
```

Expected: every job green, deploy job ends with a Vercel production URL.

- [ ] **Step 3: Verify the pipeline actually gates**

Create a branch with a deliberately failing backend test, open a PR:

```bash
git checkout -b ci-gate-check
# in backend/src/__tests__/phase8/migrate.test.js temporarily add:
#   test('gate check', () => { expect(true).toBe(false); });
git commit -am "test: deliberate failure to verify deploy gating" && git push -u origin ci-gate-check
gh pr create --fill
```

Expected: PR CI fails; **no** deploy job runs (PR event + failed needs); Vercel posts a preview URL. Then close the PR and delete the branch — do not merge:

```bash
gh pr close ci-gate-check --delete-branch
```

---

### Task 12: Documentation + end-to-end production verification

**Files:**
- Modify: `DEPLOYMENT_GUIDE.md` (add a "Production (AWS + Vercel)" section)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Document the production setup in `DEPLOYMENT_GUIDE.md`**

Add a section covering, in this order (a paragraph or command block each — content, not placeholders): architecture summary (Vercel + Fargate + RDS + Secrets Manager, paper-only), one-time setup pointers (Tasks 7–10 command summaries), how a deploy happens (push to master; what gates it), how to watch it (`gh run watch`, `copilot svc logs --name api --env prod --follow`), rollback (ECS circuit breaker automatic; manual: `copilot svc deploy` from a previous commit), secret rotation (`aws secretsmanager put-secret-value` + `copilot svc deploy` to restart tasks), and the monthly cost table from the spec.

- [ ] **Step 2: First-deploy verification checklist (run each, record results in the PR/commit message)**

```text
1. https://bearbull.app loads over HTTPS, no mixed-content warnings (browser devtools console clean)
2. Register/login round-trips (JWT issued; check Network tab hits https://api.bearbull.app)
3. Market page renders live Alpaca quotes
4. Place a paper order end-to-end; it appears in Orders
5. CloudWatch: copilot svc logs show auto-trading engine cron heartbeat
6. Deep-link https://bearbull.app/dashboard directly (SPA rewrite works)
7. aws rds describe-db-instances shows BackupRetentionPeriod: 7
8. Alpaca dashboard shows the order under the PAPER account
```

- [ ] **Step 3: Commit**

```bash
git add DEPLOYMENT_GUIDE.md
git commit -m "docs: production deployment guide for AWS + Vercel pipeline"
```

- [ ] **Step 4 (optional cleanup, separate commit):** the repo contains stray brace-expansion artifact directories — `{backend,frontend,admin,docs,deployment,database}/` at the root and `backend/src/{config,middleware,routes,services,utils,models}/`. If `git status`/`ls` confirms they are empty and untracked, remove them:

```bash
rmdir "{backend,frontend,admin,docs,deployment,database}" "backend/src/{config,middleware,routes,services,utils,models}"
```

If not empty, leave them and note it — do not force-delete.
