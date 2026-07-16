# Dashboard "Get Started" Flow — Design Spec

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan
**Scope:** Frontend only. No backend, schema, or dependency changes.

## Problem

A brand-new user signs in and lands on the Dashboard (`/`) showing `—` stat tiles and "No orders yet" / "No signals yet" (`frontend/src/pages/DashboardPage.tsx`). There is **no guidance on what to do first**. The only broker-connection nudge in the entire app is buried inside the Place Order dialog. New users hit a dead end instead of a funnel toward first value.

## Goal

Add a self-maintaining **Get Started** card at the top of the Dashboard that funnels a new user down the product's flagship **autonomous-trading** path, then disappears once they are set up. It must be seamless: no extra screens, no backend, no friction for established users.

## Decisions (locked during brainstorming)

1. **Primary path:** autonomous trading. The end state is a running engine, not a manual trade.
2. **Three tracked steps**, each auto-detected from live account state:
   1. Connect a broker
   2. Configure Auto Trading
   3. Enable the engine
3. **Funding** is shown as a one-line helper note under step 1, not a tracked checkmark (no reliable, broker-agnostic way to detect it).
4. **Lifecycle:** the card is derived purely from live state and **auto-hides once all three steps are done**. A **Dismiss** link hides it early, remembered per-device in `localStorage`. If state regresses (e.g. the broker disconnects) and the user has not dismissed, the card may reappear.
5. **No backend change.** All state comes from endpoints that already exist and are already queried elsewhere.

## Non-goals (YAGNI)

- Funding detection or any broker-balance check.
- Server-side / cross-device onboarding state.
- A dedicated `/onboarding` route or full-screen interstitial.
- Any change to auto-trading, broker, or dashboard-stat behavior.
- Manual/watchlist onboarding path (auto-trading uses its own configured symbol list, independent of the watchlist).

## Approach

A self-contained `GetStartedCard` component that runs its own two read queries, derives the three step booleans, and renders itself (or nothing). `DashboardPage` simply renders `<GetStartedCard />` at the top. Chosen over (a) computing state in `DashboardPage` and passing props — more coupling, harder to test — and (b) a dedicated onboarding route — heavier and more friction than an inline card.

## Data flow

Both queries are already cached elsewhere (`PlaceOrderDialog` uses `['broker-connections']`; `AutoTradingPage` uses `['auto-trading-settings']`), so react-query dedupes — no extra network cost.

| Derived value | Source | Rule |
|---|---|---|
| `brokerConnected` | `GET /brokers/connections` → `{ connections: BrokerConnection[] }` | any `c.status === 'connected'` |
| `autoConfigured` | `GET /auto-trading/settings` → `{ settings: AutoTradingSettings }` | `settings.broker_connection_id` is non-null **and** `settings.symbols.length > 0` |
| `engineEnabled` | same settings | `settings.enabled === true` |
| `allDone` | — | `brokerConnected && autoConfigured && engineEnabled` |
| `dismissed` | `localStorage["getStarted.dismissed"]` | truthy |
| `visible` | — | `!allDone && !dismissed && bothQueriesResolved` |

Query keys reuse the existing ones exactly (`['broker-connections']`, `['auto-trading-settings']`) so the cache is shared. Missing/empty data returns falsy for every step (a new user sees all three incomplete). While either query is still loading, the card renders nothing — no flash.

> Note: `autoConfigured` requires a broker to be **selected in the auto-trading settings**, which is a separate action from connecting the broker. It is legitimately possible to have `brokerConnected` true while `autoConfigured` is false. Step ordering (below) reflects this.

## Component design

**New files:**
- `frontend/src/components/onboarding/GetStartedCard.tsx`
- `frontend/src/components/onboarding/GetStartedCard.test.tsx`
- `frontend/src/hooks/useLocalStorage.ts` (generic, typed, with a guarded read — `try/catch` around `localStorage`/`JSON` access; no existing equivalent)
- `frontend/src/hooks/useLocalStorage.test.tsx`

**Modified:**
- `frontend/src/pages/DashboardPage.tsx` — render `<GetStartedCard />` as the first child of the page container.

**`GetStartedCard` renders** a `Card` (existing `@/components/ui/card`) titled **"Get started"** with an **"N of 3"** progress marker, then three `StepRow`s, then a footer **Dismiss** link.

**`StepRow`** (internal to the file): an icon (check when complete, otherwise a numbered/empty marker), a label, and a `react-router` `Link` to the step's route. Visual emphasis:
- **Completed** step: check icon, muted label.
- **First incomplete** step: primary styling + trailing arrow (the "do this next" affordance).
- **Later incomplete** steps: visible but de-emphasized. They remain clickable links (not disabled) — cheaper, and clicking ahead is harmless.

**Steps:**
| # | Label | Route | Helper note |
|---|---|---|---|
| 1 | Connect a broker | `/brokers` | "Fund your account with your broker to trade for real." |
| 2 | Configure Auto Trading | `/auto-trading` | — |
| 3 | Enable the engine | `/auto-trading` | — |

**Dismiss** sets `localStorage["getStarted.dismissed"] = "1"` via `useLocalStorage` and hides the card immediately (state update).

## States

| Account state | Card |
|---|---|
| Either query loading | render nothing (no flash) |
| New user (nothing done) | shown, step 1 emphasized, "0 of 3" |
| Broker connected only | shown, step 2 emphasized, "1 of 3" |
| Configured, not enabled | shown, step 3 emphasized, "2 of 3" |
| All three done | auto-hidden |
| Dismissed on this device | hidden |

## Placement

Top of `DashboardPage`, above the stat-tile grid — the first thing a new user sees, and invisible to everyone who is set up or has dismissed it. The existing "Welcome back" heading stays above it (or the card sits directly under it — implementer's call, kept visually consistent with existing `Card` spacing).

## Engine-dashboard tie-in

Step 3 links to `/auto-trading` (which shows engine status today). When PR #14's Engine Observability Dashboard (`/auto-trading/dashboard`) lands on `master`, the step-3 target / a future "monitor your engine" completion hint can point there. This is a **follow-up, not a dependency** — nothing here blocks on PR #14.

## Testing

- `GetStartedCard.test.tsx` (mocked queries + `MemoryRouter`, mirroring `PlaceOrderDialog.test.tsx` / `DashboardPage.test.tsx`):
  - renders nothing while a query is loading;
  - new user → card visible, "0 of 3", step 1 emphasized, links point to `/brokers` and `/auto-trading`;
  - broker connected only → "1 of 3", step 2 emphasized;
  - configured but not enabled → "2 of 3", step 3 emphasized;
  - all three done → renders nothing;
  - clicking Dismiss → card disappears and `localStorage` flag is set;
  - flag already set → renders nothing even when incomplete.
- `useLocalStorage.test.tsx`: reads default when unset, persists on set, reads existing value.

## Verification

- `npx tsc -b` clean.
- `npm run lint` clean (the CI-equivalent command).
- New unit tests pass; full frontend suite stays green.
- `npm run build` succeeds.
- Live check: as a new user the card shows on `/` and points to `/brokers`; after connecting a broker + configuring + enabling auto-trading it disappears; Dismiss hides it and it stays hidden on reload.

## Commit shape

One logical commit (small feature): the hook, the card + tests, and the one-line dashboard wiring.
