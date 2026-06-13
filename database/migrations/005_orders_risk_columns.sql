-- Add stop-loss/take-profit columns to orders so risk-managed orders
-- (Alpaca bracket orders, etc.) can persist the requested exit levels.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stop_loss DECIMAL(20, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS take_profit DECIMAL(20, 8);
