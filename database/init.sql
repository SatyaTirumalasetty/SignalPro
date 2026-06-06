-- SignalPro Enterprise Database Initialization
-- Run this once on a fresh PostgreSQL 14+ instance
-- psql -U postgres -f init.sql -d signalpro_prod

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "inet";

-- Enums
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE kyc_status AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE broker_status AS ENUM ('connected', 'disconnected', 'expired', 'error');
CREATE TYPE position_type AS ENUM ('long', 'short');
CREATE TYPE position_status AS ENUM ('open', 'closed');
CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop', 'trailing_stop');
CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_status AS ENUM ('pending', 'open', 'filled', 'partially_filled', 'cancelled', 'rejected');
CREATE TYPE signal_type AS ENUM ('buy', 'sell', 'hold');
CREATE TYPE signal_status AS ENUM ('active', 'executed', 'expired', 'cancelled');
CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'execute_trade', 'api_call', 'login', 'logout', 'permission_change');
CREATE TYPE audit_status AS ENUM ('success', 'failed');
CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled', 'past_due');
CREATE TYPE billing_cycle AS ENUM ('monthly', 'annual');
CREATE TYPE payment_method AS ENUM ('card', 'upi', 'bank_transfer', 'stripe', 'razorpay', 'paypal');
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'failed', 'refunded');
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
CREATE TYPE ticket_category AS ENUM ('billing', 'technical', 'broker_issue', 'feature_request');
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed');
CREATE TYPE admin_role AS ENUM ('super_admin', 'admin', 'support', 'finance');
CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE alert_status AS ENUM ('active', 'acknowledged', 'resolved');

-- PHASE 1: Core Tables
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  phone VARCHAR(20),
  country VARCHAR(2),
  status user_status DEFAULT 'active',
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  kyc_status kyc_status DEFAULT 'pending',
  kyc_data JSONB,
  preferences JSONB DEFAULT '{"timezone":"UTC","currency":"USD","notifications":true}',
  totp_secret VARCHAR(64),
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  CONSTRAINT email_lowercase CHECK (email = LOWER(email))
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_kyc_status ON users(kyc_status);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  ip_address INET,
  user_agent VARCHAR(500),
  device_name VARCHAR(100),
  expires_at TIMESTAMP NOT NULL,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_token_hash ON user_sessions(token_hash);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100),
  last_used_at TIMESTAMP,
  last_ip INET,
  rate_limit INT DEFAULT 1000,
  scope JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_active ON api_keys(active);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  action audit_action,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent VARCHAR(500),
  status audit_status DEFAULT 'success',
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_status ON audit_logs(status);

CREATE TABLE email_verification_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_evt_user_id ON email_verification_tokens(user_id);
CREATE INDEX idx_evt_token   ON email_verification_tokens(token);
CREATE INDEX idx_evt_expires ON email_verification_tokens(expires_at);

CREATE TABLE password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_prt_expires    ON password_reset_tokens(expires_at);

-- PHASE 2: Trading & Brokers
CREATE TABLE broker_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_id VARCHAR(50) NOT NULL,
  name VARCHAR(100),
  status broker_status DEFAULT 'connected',
  credentials_encrypted TEXT NOT NULL,
  account_info JSONB,
  last_sync TIMESTAMP,
  sync_error TEXT,
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, broker_id)
);

CREATE INDEX idx_broker_connections_user_id ON broker_connections(user_id);
CREATE INDEX idx_broker_connections_status ON broker_connections(status);
CREATE INDEX idx_broker_connections_broker_id ON broker_connections(broker_id);

CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_connection_id UUID REFERENCES broker_connections(id) ON DELETE SET NULL,
  symbol VARCHAR(20) NOT NULL,
  market VARCHAR(10),
  quantity DECIMAL(20, 8) NOT NULL,
  entry_price DECIMAL(20, 8) NOT NULL,
  current_price DECIMAL(20, 8),
  position_type position_type DEFAULT 'long',
  status position_status DEFAULT 'open',
  pnl DECIMAL(20, 2),
  pnl_percent DECIMAL(8, 2),
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_symbol ON positions(symbol);
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_user_symbol ON positions(user_id, symbol);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_connection_id UUID REFERENCES broker_connections(id),
  broker_order_id VARCHAR(100),
  symbol VARCHAR(20) NOT NULL,
  order_type order_type DEFAULT 'market',
  side order_side NOT NULL,
  quantity DECIMAL(20, 8) NOT NULL,
  price DECIMAL(20, 8),
  status order_status DEFAULT 'pending',
  filled_quantity DECIMAL(20, 8) DEFAULT 0,
  average_price DECIMAL(20, 8),
  signal_id UUID,
  created_by_ai BOOLEAN DEFAULT FALSE,
  ai_confidence DECIMAL(5, 2),
  order_message TEXT,
  error_message TEXT,
  executed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_symbol ON orders(symbol);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_side ON orders(side);

CREATE TABLE historical_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  market VARCHAR(10),
  signal_type signal_type NOT NULL,
  confidence DECIMAL(5, 2),
  timeframe VARCHAR(10),
  indicators JSONB,
  analysis_text TEXT,
  ai_model VARCHAR(50) DEFAULT 'claude-sonnet-4-5',
  ai_tokens_used INT,
  predicted_price DECIMAL(20, 8),
  predicted_price_high DECIMAL(20, 8),
  predicted_price_low DECIMAL(20, 8),
  entry_price DECIMAL(20, 8),
  stop_loss DECIMAL(20, 8),
  take_profit DECIMAL(20, 8),
  status signal_status DEFAULT 'active',
  actual_result JSONB,
  execution_price DECIMAL(20, 8),
  executed_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_signals_user_id ON historical_signals(user_id);
CREATE INDEX idx_signals_symbol ON historical_signals(symbol);
CREATE INDEX idx_signals_status ON historical_signals(status);
CREATE INDEX idx_signals_created_at ON historical_signals(created_at DESC);
CREATE INDEX idx_signals_expires_at ON historical_signals(expires_at);

CREATE TABLE signal_cache (
  symbol VARCHAR(20) PRIMARY KEY,
  market VARCHAR(10),
  latest_signal_id UUID REFERENCES historical_signals(id),
  signal_data JSONB,
  ttl_seconds INT DEFAULT 300,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_signal_cache_updated_at ON signal_cache(updated_at);

CREATE TABLE price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  market VARCHAR(10) NOT NULL,
  open DECIMAL(20, 8),
  high DECIMAL(20, 8),
  low DECIMAL(20, 8),
  close DECIMAL(20, 8),
  volume BIGINT,
  timeframe VARCHAR(10),
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, timeframe, timestamp)
);

CREATE INDEX idx_price_snapshots_symbol_tf ON price_snapshots(symbol, timeframe);
CREATE INDEX idx_price_snapshots_timestamp ON price_snapshots(timestamp DESC);

-- PHASE 3: Billing & Subscriptions
CREATE TABLE pricing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  tier VARCHAR(20) UNIQUE,
  description TEXT,
  price_monthly DECIMAL(10, 2),
  price_annual DECIMAL(10, 2),
  ai_analysis_credits INT DEFAULT 100,
  max_positions INT DEFAULT 50,
  max_watchlists INT DEFAULT 10,
  max_api_calls_per_minute INT DEFAULT 120,
  features JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES pricing_plans(id),
  status subscription_status DEFAULT 'active',
  billing_cycle billing_cycle DEFAULT 'monthly',
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  payment_method payment_method,
  last_payment_id VARCHAR(100),
  auto_renew BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_current_period_end ON subscriptions(current_period_end);

CREATE TABLE usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  metric_name VARCHAR(50),
  usage_count INT DEFAULT 0,
  limit_count INT,
  billing_period_start TIMESTAMP,
  billing_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usage_metrics_user_id ON usage_metrics(user_id);
CREATE INDEX idx_usage_metrics_metric ON usage_metrics(metric_name);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status invoice_status DEFAULT 'draft',
  payment_date TIMESTAMP,
  due_date TIMESTAMP,
  invoice_number VARCHAR(50) UNIQUE,
  pdf_url VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_status ON invoices(status);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status payment_status DEFAULT 'pending',
  payment_method VARCHAR(50),
  transaction_id VARCHAR(100),
  gateway_response JSONB,
  refund_amount DECIMAL(10, 2),
  refund_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);

-- PHASE 4: Admin Management
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  role admin_role DEFAULT 'admin',
  permissions JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_role ON admin_users(role);

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(255),
  description TEXT,
  category ticket_category,
  priority ticket_priority DEFAULT 'medium',
  status ticket_status DEFAULT 'open',
  assigned_to UUID REFERENCES admin_users(id),
  resolution_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_priority ON support_tickets(priority);

CREATE TABLE system_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(50),
  severity alert_severity DEFAULT 'warning',
  message TEXT,
  affected_users INT,
  status alert_status DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

-- Useful views for reporting
CREATE VIEW user_dashboard AS
SELECT 
  u.id, u.email, u.full_name,
  s.status as subscription_status,
  p.tier as plan_tier,
  COUNT(DISTINCT pos.id) as open_positions,
  COUNT(DISTINCT bc.id) as connected_brokers,
  SUM(COALESCE(pos.pnl, 0)) as total_pnl
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id
LEFT JOIN pricing_plans p ON s.plan_id = p.id
LEFT JOIN positions pos ON u.id = pos.user_id AND pos.status = 'open'
LEFT JOIN broker_connections bc ON u.id = bc.user_id
GROUP BY u.id, s.status, p.tier;

CREATE VIEW signal_performance AS
SELECT 
  hs.symbol, hs.market, hs.signal_type,
  COUNT(*) as total_signals,
  SUM(CASE WHEN hs.status = 'executed' THEN 1 ELSE 0 END) as executed_signals,
  AVG(hs.confidence) as avg_confidence,
  AVG((hs.actual_result->>'pnl')::DECIMAL) as avg_pnl,
  AVG((hs.actual_result->>'pnl_percent')::DECIMAL) as avg_pnl_percent
FROM historical_signals hs
WHERE hs.executed_at IS NOT NULL
GROUP BY hs.symbol, hs.market, hs.signal_type;

-- Insert default pricing plans
INSERT INTO pricing_plans (name, tier, description, price_monthly, price_annual, ai_analysis_credits, features)
VALUES 
  ('Starter', 'starter', 'Perfect to get started', 29.99, 299.99, 50, '{"advanced_indicators":false,"portfolio_analytics":false,"webhook_alerts":false}'),
  ('Professional', 'pro', 'For active traders', 99.99, 999.99, 500, '{"advanced_indicators":true,"portfolio_analytics":true,"webhook_alerts":false}'),
  ('Enterprise', 'enterprise', 'Ultimate trading suite', 299.99, 2999.99, 5000, '{"advanced_indicators":true,"portfolio_analytics":true,"webhook_alerts":true,"custom_strategies":true,"dedicated_support":true}');
