# Dashboard "Get Started" Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-hiding "Get started" onboarding card to the top of the Dashboard that funnels new users down the autonomous-trading path (connect broker → configure auto-trading → enable engine).

**Architecture:** A self-contained `GetStartedCard` component runs its own two react-query reads (reusing the existing `['broker-connections']` and `['auto-trading-settings']` cache keys, so no extra network cost), derives three step booleans, and renders itself or `null`. It auto-hides when all three steps are done and supports a per-device `localStorage` dismiss via a new `useLocalStorage` hook. `DashboardPage` renders it as one line. No backend, schema, or dependency changes.

**Tech Stack:** React 19 + TypeScript, React Router (`Link`), TanStack Query v5, Vitest + Testing Library, Tailwind v4, lucide-react.

## Global Constraints

- **Frontend only.** No backend, schema, dependency, or `types/api.ts` changes. `AutoTradingSettings` (`enabled`, `broker_connection_id`, `symbols`) and `BrokerConnection` (`status`) already exist on `master`.
- **Reuse existing query keys verbatim:** `['broker-connections']` (→ `GET /brokers/connections`, `{ connections }`) and `['auto-trading-settings']` (→ `GET /auto-trading/settings`, `{ settings }`) so the react-query cache is shared with `PlaceOrderDialog`/`AutoTradingPage`.
- **Derive visibility purely from live state.** Show only while incomplete and not dismissed; render nothing while either query is loading (no flash); auto-hide when all three steps are done.
- **Dismiss key:** `localStorage["getStarted.dismissed"]`, value `"1"`.
- **No behavior change** to auto-trading, brokers, or the existing dashboard tiles.
- **Lint gate:** run `cd frontend && npm run lint` (== CI: `eslint . --max-warnings 0`) before every commit.
- **Branch:** work happens on `feat/dashboard-get-started` (already created off `master`, holds the design spec commit).
- Spec: `docs/superpowers/specs/2026-07-16-dashboard-get-started-design.md`.

---

### Task 1: `useLocalStorage` hook

A minimal string-valued hook with guarded reads/writes (private mode / quota safe). Sufficient for the dismiss flag — no JSON/generics needed (YAGNI).

**Files:**
- Create: `frontend/src/hooks/useLocalStorage.ts`
- Test: `frontend/src/hooks/useLocalStorage.test.tsx`

**Interfaces:**
- Produces (consumed by Task 2): `useLocalStorage(key: string): [string | null, (value: string | null) => void]` from `@/hooks/useLocalStorage`. Passing `null` to the setter removes the key.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useLocalStorage.test.tsx`:
```tsx
import { renderHook, act } from '@testing-library/react'
import { describe, test, expect, beforeEach } from 'vitest'
import { useLocalStorage } from './useLocalStorage'

describe('useLocalStorage', () => {
  beforeEach(() => localStorage.clear())

  test('returns null when the key is unset', () => {
    const { result } = renderHook(() => useLocalStorage('k'))
    expect(result.current[0]).toBeNull()
  })

  test('reads an existing value on mount', () => {
    localStorage.setItem('k', 'x')
    const { result } = renderHook(() => useLocalStorage('k'))
    expect(result.current[0]).toBe('x')
  })

  test('persists a value and updates state', () => {
    const { result } = renderHook(() => useLocalStorage('k'))
    act(() => result.current[1]('1'))
    expect(result.current[0]).toBe('1')
    expect(localStorage.getItem('k')).toBe('1')
  })

  test('removes the key when set to null', () => {
    localStorage.setItem('k', '1')
    const { result } = renderHook(() => useLocalStorage('k'))
    act(() => result.current[1](null))
    expect(result.current[0]).toBeNull()
    expect(localStorage.getItem('k')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useLocalStorage.test.tsx`
Expected: FAIL — `useLocalStorage` cannot be imported (module does not exist).

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/hooks/useLocalStorage.ts`:
```ts
import { useCallback, useState } from 'react'

/**
 * Persist a single string flag in localStorage. Reads and writes are guarded so
 * a disabled/quota-exceeded localStorage (private mode) degrades to in-memory state.
 * Pass `null` to the setter to remove the key.
 */
export function useLocalStorage(key: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  })

  const set = useCallback(
    (next: string | null) => {
      setValue(next)
      try {
        if (next === null) localStorage.removeItem(key)
        else localStorage.setItem(key, next)
      } catch {
        // ignore write failures (private mode / quota)
      }
    },
    [key],
  )

  return [value, set]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useLocalStorage.test.tsx`
Expected: 4 tests pass.

- [ ] **Step 5: Typecheck + lint**

Run: `cd frontend && npx tsc -b && npm run lint`
Expected: both exit 0, no output.

- [ ] **Step 6: Commit**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git add frontend/src/hooks/useLocalStorage.ts frontend/src/hooks/useLocalStorage.test.tsx
git commit -m "feat: add useLocalStorage hook"
```

---

### Task 2: `GetStartedCard` component

The onboarding card: two derived reads, three steps, first-incomplete emphasis, funding note, dismiss.

**Files:**
- Create: `frontend/src/components/onboarding/GetStartedCard.tsx`
- Test: `frontend/src/components/onboarding/GetStartedCard.test.tsx`

**Interfaces:**
- Consumes (from Task 1): `useLocalStorage` from `@/hooks/useLocalStorage`.
- Consumes (on `master`): `Card`, `CardContent`, `CardHeader`, `CardTitle` from `@/components/ui/card`; `api` from `@/lib/api`; `cn` from `@/lib/utils`; `AutoTradingSettings`, `BrokerConnection` from `@/types/api`.
- Produces (consumed by Task 3): `GetStartedCard` (React component, no props) from `@/components/onboarding/GetStartedCard`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/onboarding/GetStartedCard.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest'
import { GetStartedCard } from './GetStartedCard'
import { api } from '@/lib/api'
import type { AutoTradingSettings, BrokerConnection } from '@/types/api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}))

const connected: BrokerConnection[] = [{ id: 'conn-1', broker_id: 'alpaca', name: 'My Alpaca', status: 'connected' }]

function makeSettings(overrides: Partial<AutoTradingSettings> = {}): AutoTradingSettings {
  return {
    enabled: false,
    broker_connection_id: null,
    symbols: [],
    timeframes: [],
    min_confidence: 70,
    risk_per_trade_pct: 0.01,
    max_daily_loss_pct: 0.05,
    cooldown_minutes: 60,
    max_trades_per_day: 5,
    ...overrides,
  }
}

function mockState(connections: BrokerConnection[], settings: AutoTradingSettings) {
  ;(api.get as Mock).mockImplementation((url: string) => {
    if (url === '/brokers/connections') return Promise.resolve({ data: { connections } })
    if (url === '/auto-trading/settings') return Promise.resolve({ data: { settings } })
    return Promise.resolve({ data: {} })
  })
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GetStartedCard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('GetStartedCard', () => {
  test('new user: shows card at 0 of 3 with step 1 linking to /brokers', async () => {
    mockState([], makeSettings())
    renderCard()
    expect(await screen.findByText('Get started')).toBeInTheDocument()
    expect(screen.getByText('0 of 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Connect a broker/ })).toHaveAttribute('href', '/brokers')
    expect(screen.getByText(/Fund your account/)).toBeInTheDocument()
  })

  test('broker connected only: shows 1 of 3', async () => {
    mockState(connected, makeSettings())
    renderCard()
    expect(await screen.findByText('Get started')).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Configure Auto Trading/ })).toHaveAttribute('href', '/auto-trading')
  })

  test('configured but not enabled: shows 2 of 3', async () => {
    mockState(connected, makeSettings({ broker_connection_id: 'conn-1', symbols: ['AAPL'] }))
    renderCard()
    expect(await screen.findByText('Get started')).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  test('all steps done: renders nothing', async () => {
    mockState(connected, makeSettings({ broker_connection_id: 'conn-1', symbols: ['AAPL'], enabled: true }))
    renderCard()
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Get started')).not.toBeInTheDocument())
  })

  test('dismissed on this device: renders nothing even when incomplete', async () => {
    localStorage.setItem('getStarted.dismissed', '1')
    mockState([], makeSettings())
    renderCard()
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Get started')).not.toBeInTheDocument())
  })

  test('clicking Dismiss hides the card and persists the flag', async () => {
    mockState([], makeSettings())
    renderCard()
    expect(await screen.findByText('Get started')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Dismiss/i }))
    expect(screen.queryByText('Get started')).not.toBeInTheDocument()
    expect(localStorage.getItem('getStarted.dismissed')).toBe('1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/onboarding/GetStartedCard.test.tsx`
Expected: FAIL — `GetStartedCard` cannot be imported (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/onboarding/GetStartedCard.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Check, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import type { AutoTradingSettings, BrokerConnection } from '@/types/api'

const DISMISS_KEY = 'getStarted.dismissed'

interface Step {
  label: string
  to: string
  done: boolean
  note?: string
}

export function GetStartedCard() {
  const [dismissed, setDismissed] = useLocalStorage(DISMISS_KEY)

  const connectionsQuery = useQuery({
    queryKey: ['broker-connections'],
    queryFn: async () =>
      (await api.get<{ connections: BrokerConnection[] }>('/brokers/connections')).data.connections,
  })
  const settingsQuery = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () =>
      (await api.get<{ settings: AutoTradingSettings }>('/auto-trading/settings')).data.settings,
  })

  // Wait for both reads before deciding visibility — avoids a flash of the card.
  if (connectionsQuery.isLoading || settingsQuery.isLoading) return null

  const connections = connectionsQuery.data ?? []
  const settings = settingsQuery.data ?? null

  const brokerConnected = connections.some((c) => c.status === 'connected')
  const autoConfigured = !!settings?.broker_connection_id && (settings?.symbols.length ?? 0) > 0
  const engineEnabled = settings?.enabled === true

  const steps: Step[] = [
    {
      label: 'Connect a broker',
      to: '/brokers',
      done: brokerConnected,
      note: 'Fund your account with your broker to trade for real.',
    },
    { label: 'Configure Auto Trading', to: '/auto-trading', done: autoConfigured },
    { label: 'Enable the engine', to: '/auto-trading', done: engineEnabled },
  ]

  const completedCount = steps.filter((s) => s.done).length
  const allDone = completedCount === steps.length

  if (allDone || dismissed) return null

  const firstIncompleteIndex = steps.findIndex((s) => !s.done)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Get started</CardTitle>
        <span className="text-xs text-muted">
          {completedCount} of {steps.length}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {steps.map((step, i) => {
          const current = i === firstIncompleteIndex
          return (
            <div key={step.label} className="flex flex-col">
              <Link
                to={step.to}
                className={cn(
                  'group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                  step.done
                    ? 'text-muted'
                    : current
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:bg-elevated',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs',
                    step.done
                      ? 'border-success text-success'
                      : current
                        ? 'border-primary text-primary'
                        : 'border-border text-muted',
                  )}
                >
                  {step.done ? <Check size={14} /> : i + 1}
                </span>
                <span className="flex-1">{step.label}</span>
                {current && <ArrowRight size={16} className="shrink-0" />}
              </Link>
              {step.note && !step.done && <p className="pl-10 text-xs text-muted">{step.note}</p>}
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setDismissed('1')}
          className="self-start px-2 pt-1 text-xs text-muted hover:text-foreground cursor-pointer"
        >
          Dismiss
        </button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/onboarding/GetStartedCard.test.tsx`
Expected: 6 tests pass.

- [ ] **Step 5: Typecheck + lint**

Run: `cd frontend && npx tsc -b && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git add frontend/src/components/onboarding/GetStartedCard.tsx frontend/src/components/onboarding/GetStartedCard.test.tsx
git commit -m "feat: add Get Started onboarding card"
```

---

### Task 3: Wire into the Dashboard + integration verification

Render the card at the top of the Dashboard (below the welcome heading, above the stat tiles) and verify the full suite, build, and a live drive.

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Test: `frontend/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes (from Task 2): `GetStartedCard` from `@/components/onboarding/GetStartedCard`.

- [ ] **Step 1: Add an assertion to the Dashboard test that the card renders for a new user**

In `frontend/src/pages/DashboardPage.test.tsx`, the existing "empty states" test already mocks empty portfolio/orders/signals and returns `{ data: {} }` for other URLs (so the card's two reads resolve to a new-user state). Add one assertion to that test, immediately after `renderPage()` inside `test('shows empty states when there are no orders or signals', ...)`:
```tsx
    expect(await screen.findByText('Get started')).toBeInTheDocument()
```
(Place it before the existing `No orders yet` assertion. No other changes to the test file are needed — `api.get`'s default `{ data: {} }` branch already covers `/brokers/connections` and `/auto-trading/settings`.)

- [ ] **Step 2: Run the Dashboard test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx -t "empty states"`
Expected: FAIL — "Get started" is not in the document (the card is not wired into `DashboardPage` yet).

- [ ] **Step 3: Wire the card into the Dashboard**

In `frontend/src/pages/DashboardPage.tsx`, add the import after the existing `Badge` import (line 4):
```tsx
import { Badge } from '@/components/ui/badge'
import { GetStartedCard } from '@/components/onboarding/GetStartedCard'
```

Then insert `<GetStartedCard />` between the welcome-heading block and the stat-tile grid. Change:
```tsx
      <div>
        <h1 className="text-xl font-semibold text-foreground">Welcome back{user?.full_name ? `, ${user.full_name}` : ''}</h1>
        <p className="text-sm text-muted">Here's what's happening with your portfolio</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
```
to:
```tsx
      <div>
        <h1 className="text-xl font-semibold text-foreground">Welcome back{user?.full_name ? `, ${user.full_name}` : ''}</h1>
        <p className="text-sm text-muted">Here's what's happening with your portfolio</p>
      </div>

      <GetStartedCard />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
```

- [ ] **Step 4: Run the Dashboard test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx`
Expected: all Dashboard tests pass (including the new "Get started" assertion).

- [ ] **Step 5: Full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all suites pass (existing suites + `useLocalStorage`, `GetStartedCard`, and the updated Dashboard test).

- [ ] **Step 6: Typecheck, lint, build**

Run: `cd frontend && npx tsc -b && npm run lint && npm run build`
Expected: `tsc` clean, `npm run lint` exits 0, build ends with `✓ built` (pre-existing chunk-size warning is acceptable).

- [ ] **Step 7: Live click-through**

Start the stack (Docker Postgres/Redis, `cd backend && npm start`, `cd frontend && npm run dev`), register a fresh user, and open `/`. Verify:
- the "Get started" card appears at the top, "0 of 3", step 1 emphasized and linking to `/brokers`, funding note visible;
- connecting a broker moves it to "1 of 3"; configuring auto-trading (select broker + add a symbol) → "2 of 3"; enabling the engine → the card disappears;
- clicking **Dismiss** hides it and it stays hidden after a page reload;
- no console errors.

- [ ] **Step 8: Commit**

```bash
cd /c/My_World/Projects/signalpro-enterprise
git add frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.test.tsx
git commit -m "feat: show Get Started card on the dashboard"
```

---

## Self-Review

**Spec coverage:**
- 3 auto-detected steps (connect broker / configure / enable) → Task 2 Step 3 (`steps` array + derivations). ✅
- Data-flow rules (`brokerConnected`, `autoConfigured`, `engineEnabled`, reused query keys) → Task 2 Step 3. ✅
- Funding as helper note under step 1, not a checkmark → Task 2 Step 3 (`note` shown when `!step.done`) + test. ✅
- Auto-hide when complete + `localStorage` dismiss + no flash while loading → Task 2 Step 3 (`isLoading` guard, `allDone`/`dismissed` returns) + tests (all-done, dismissed, click-dismiss). ✅
- New files (`GetStartedCard` + test, `useLocalStorage` + test) and one-line Dashboard wiring → Tasks 1–3. ✅
- Placement (top of Dashboard, below welcome heading, above tiles) → Task 3 Step 3. ✅
- State table (loading/new/1-of-3/2-of-3/all-done/dismissed) → Task 2 test cases. ✅
- No backend / schema / dependency / `types/api.ts` change → Global Constraints; nothing in the tasks touches them. ✅
- Engine-dashboard tie-in is a follow-up, not a dependency → step 3 links to `/auto-trading`; no PR #14 reference in code. ✅
- Verification (tsc, lint, tests, build, live) → Task 3 Steps 4–7. ✅

**Placeholder scan:** No TBD/TODO; every code step shows exact content; every command has expected output. ✅

**Type consistency:** `useLocalStorage(key) => [string | null, (v: string | null) => void]` defined in Task 1 matches its use in Task 2. `GetStartedCard` (no props) defined in Task 2 matches its import/use in Task 3. Query keys `['broker-connections']` / `['auto-trading-settings']` and endpoint shapes (`{ connections }` / `{ settings }`) match `AutoTradingSettings`/`BrokerConnection` in `types/api.ts`. Dismiss key `getStarted.dismissed` is identical across component and tests. ✅

**Commit shape note:** This plan yields three commits (hook, card, wiring) — finer than the spec's suggested "one logical commit." Acceptable, and consistent with the frequent-commits guidance; the three can be squashed at merge if desired.
