-- Support for the autonomous trading engine: tag orders by their origin and
-- record each analysis/decision cycle for the per-user activity feed.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS auto_trading_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  decision VARCHAR(10),                -- buy | sell | hold | null (pre-analysis skips)
  confidence NUMERIC(5,2),
  action VARCHAR(30) NOT NULL,         -- order_placed | skipped_* | error
  signal_id UUID REFERENCES historical_signals(id),
  order_id UUID REFERENCES orders(id),
  reasoning TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auto_trading_runs_user_created ON auto_trading_runs(user_id, created_at DESC);
