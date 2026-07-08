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
