# Autonomous Trading Engine v2 — Design

**Date:** 2026-07-08
**Status:** Approved design, pending implementation plan
**Sub-project:** 1 of 4 (engine v2 → local real-account testing → observability dashboard → UI modernization)

## Goal

Evolve the existing v1 auto-trading engine (`backend/src/services/autoTradingEngine.js`) into the core product: Claude analyzing **fused multi-timeframe** market data per symbol, autonomously opening **and managing/closing** positions, with a user-selectable AI cost/intelligence mode. Manual signal generation remains as a secondary, opt-in path.

## Success criteria

1. **Profitable paper trial:** the engine runs unattended on an Alpaca paper account for 2–4 weeks, manages entries and exits, and every decision is auditable per trade (prompt context → decision JSON → guardrail results → action).
2. **Beats buy-and-hold:** over the trial period, engine equity outperforms an equal-weight buy-and-hold of the same watchlist (frozen at trial start), as shown by the built-in benchmark chart.

Live (real-money) use comes only after the trial passes; that evaluation is operational, not part of this implementation.

## What v1 already provides (kept)

- Cron cycle every 15 min (`7,22,37,52 * * * *`), per-user opt-in via `preferences.auto_trading`.
- Guardrails: min confidence, per-symbol cooldown, max trades/day, 1% risk-per-trade sizing (`riskManagement.calculatePositionSize`), 3% daily loss limit, circuit breaker (5 consecutive errors → auto-disable + email), master `AUTO_TRADING_ENABLED` env kill switch.
- Shared order placement (`orderExecution.placeOrder`), broker adapter registry, run audit table `auto_trading_runs`, email notifications, settings/activity/status API, `AutoTradingPage` UI.

## v1 gaps this design closes

1. Each (symbol, timeframe) analyzed independently — no fused view; conflicting trades possible on one symbol.
2. Entry-only: positions are never reviewed or closed by the engine; exits rely on the bracket sent at entry.
3. Fixed model (`claude-sonnet-4-6`, 1024 tokens, last 5 candles); no extended thinking, no portfolio context, no cost/intelligence choice.

## Architecture (chosen: structured decision pipeline)

Considered: (A) structured pipeline, (B) agentic tool-use analyst, (C) hybrid. **A chosen** — predictable cost, per-trade auditability (exactly what the paper trial needs), reuses most of v1. The decision schema and context assembly are designed so an agentic loop can slot in later without a fork.

### Cycle flow (per user, per symbol)

1. **Universe** = watchlist symbols ∪ symbols with open positions (a de-watchlisted symbol keeps being managed until its position closes).
2. **Context assembly** — new `backend/src/services/marketContext.js`: candles + indicators for every configured timeframe, recent news, open position details (entry, current P&L, age, current stop/target) if any, portfolio state (equity, exposure %, today's realized P&L, open position count).
3. **Decision call** — reworked `aiAnalysis.js`: one Claude call with the fused context returns one structured decision. Model/thinking selected by the user's `ai_mode`.
4. **Guardrail gate** — deterministic code (extends `riskManagement.js`): authority toggles, min confidence, cooldown, max trades/day, daily loss limit, risk sizing, never-widen-stop. Claude proposes; code disposes. Failed checks log a skipped run with the reason.
5. **Execution** — extends `orderExecution.js` and the Alpaca adapter with: close position, replace/modify stop and take-profit. Alpaca only for autonomous trading in v2; other brokers log `skipped_unsupported_broker` for any action their adapter can't perform.
6. **Audit** — one `auto_trading_runs` row per decision: decision JSON, guardrail results, action taken (in new `action_detail` JSONB).

### Decision schema (one shape for entries and exits)

```json
{
  "action": "open_long | open_short | close | adjust_stop | partial_exit | add | hold",
  "confidence": 0-100,
  "reasoning": "2-4 sentences",
  "timeframe_alignment": {"15m": "bullish|bearish|neutral", "1h": "...", "4h": "...", "1d": "..."},
  "entry_price": null, "stop_loss": null, "take_profit": null,
  "exit_fraction": null,
  "risk_reward": null,
  "invalidation": "what would make this decision wrong"
}
```

Position reviews are not a second pipeline: an open position makes the position section of the prompt non-empty and unlocks exit/adjust actions in the schema.

## AI modes (user-selectable)

New `backend/src/services/aiModes.js`; model IDs live in config/env, not code.

| Mode | Screening pass | Decision model | Extended thinking | Context |
|---|---|---|---|---|
| `minimize` | none | Haiku | no | trimmed (2 timeframes, fewer candles) |
| `balanced` *(default)* | none | Sonnet | no | full, with prompt caching on system prompt + static context |
| `tiered` | Haiku over all symbols: "worth deep analysis?" | balanced's decision model, on candidates only | no | open positions always go to the decision model |
| `max` | none | top configured model | yes | full |

Each mode has a plain-language description with estimated relative cost, rendered in the UI as a collapsible note.

## Settings & authority

Extends `preferences.auto_trading` JSONB and `PUT /api/auto-trading/settings` validation:

- `ai_mode`: `minimize | balanced | tiered | max` (default `balanced`).
- `authority`: `{ close: true, adjust_stop: false, partial_exit: false, add: false }` — full exit on by default; the rest opt-in. `adjust_stop` may only tighten (never widen) a stop.
- Existing keys unchanged; `timeframes` now means "which timeframes feed the fused analysis".

**UI (`AutoTradingPage`):** AI-mode radio group with a collapsible description per option; Engine-authority toggle group, each toggle with a collapsible explanation of the risk it enables; activity feed rendering the new action types with reasoning and timeframe-alignment chips.

## Data model (one migration)

- `auto_trading_runs`: add `action_detail` JSONB; new `action` values: `position_closed`, `stop_adjusted`, `partial_exit`, `position_added`, `skipped_authority`, `screened_out`, `skipped_unsupported_broker`, `needs_attention`.
- New `benchmark_snapshots`: `(id, user_id, date, engine_equity, watchlist_value, watchlist_composition JSONB, created_at)`, unique on `(user_id, date)`.

## Benchmark tracking

Daily cron snapshots engine account equity and the value of an equal-weight buy-and-hold of the watchlist frozen at trial start (composition stored on first snapshot). `GET /api/auto-trading/benchmark` returns both series; `AutoTradingPage` charts them with the existing `lightweight-charts` dependency.

## Error handling

- Every failure path writes a run row with a reason; the v1 circuit breaker and disable-email behavior are unchanged.
- Malformed decision JSON → retry once, then log `error`. Never infer a trade from a malformed response.
- Adapter missing a capability → `skipped_unsupported_broker`, never a silent no-op.
- Partial multi-leg failure (e.g. position closed but stop-cancel failed) → run flagged `needs_attention` + email; dangling orders are a real risk.
- **Fail closed for entries, fail safe for exits:** if guardrail inputs can't be evaluated (e.g. equity fetch fails), block new entries but still execute a `close` decision — flat is the safe direction.

## Testing

Jest, mocked Anthropic client and broker adapters (same stack as v1 tests):

- Unit: decision-schema validation; each guardrail including never-widen-stop and every authority toggle; AI-mode routing (model choice, screening path, thinking flag); sizing for `add` and `partial_exit`.
- Integration: full cycle with mocked Claude — one test per action type asserting DB rows and adapter calls; conflict cases (action allowed by Claude but denied by authority/guardrail → correct skip row).
- Backtester continues to consume the same `riskManagement` functions so live and backtest sizing cannot drift.

## Out of scope (v2)

- Agentic tool-use decision loop (documented upgrade path, not built).
- Autonomous trading on non-Alpaca brokers (they remain manual/read-only).
- Options, futures, or crypto-specific logic.
- Observability dashboard (roadmap #3) and UI modernization (roadmap #4).
