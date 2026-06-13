-- Add stop_loss/take_profit columns expected by POST /api/trading/orders
-- (src/routes/trading.js) but missing from the orders table.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stop_loss numeric(20,8),
  ADD COLUMN IF NOT EXISTS take_profit numeric(20,8);
