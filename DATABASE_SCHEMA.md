# SignalPro Enterprise Database Schema

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     AUTHENTICATION                           │
│  users | user_sessions | api_keys | audit_logs             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    CORE TRADING                              │
│  portfolios | watchlists | positions | orders               │
│  historical_signals | signal_cache | price_snapshots        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  BROKER MANAGEMENT                           │
│  broker_connections | broker_credentials (encrypted)        │
│  broker_webhooks | broker_sync_logs                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  BILLING & SUBSCRIPTION                      │
│  subscriptions | usage_metrics | invoices | payments        │
│  pricing_plans | billing_events                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              ADMIN & MONITORING                              │
│  admin_users | support_tickets | system_alerts              │
│  performance_metrics | rate_limits | feature_flags          │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Core Tables (Weeks 1-2)

### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  phone VARCHAR(20),
  country VARCHAR(2),
  status ENUM('active', 'suspended', 'deleted') DEFAULT 'active',
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  kycstatus ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
  kyc_data JSONB, -- encrypted PII: passport, ID, address proof
  preferences JSONB, -- timezone, currency, notification settings
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  INDEX idx_email(email),
  INDEX idx_status(status),
  INDEX idx_created_at(created_at)
);
```

### user_sessions
```sql
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  ip_address INET,
  user_agent VARCHAR(500),
  device_name VARCHAR(100),
  expires_at TIMESTAMP NOT NULL,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_expires_at(expires_at)
);
```

### api_keys
```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100),
  last_used_at TIMESTAMP,
  last_ip INET,
  rate_limit INT DEFAULT 1000,
  scope JSONB, -- ["trading", "analysis", "portfolio_view"]
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_active(active)
);
```

### audit_logs
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(50), -- 'order', 'broker_connection', 'subscription', etc
  entity_id UUID,
  action VARCHAR(50), -- 'create', 'update', 'delete', 'execute_trade', 'api_call'
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent VARCHAR(500),
  status ENUM('success', 'failed') DEFAULT 'success',
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_entity(entity_type, entity_id),
  INDEX idx_action(action),
  INDEX idx_created_at(created_at),
  INDEX idx_status(status)
);
```

## Phase 2: Trading & Brokers (Weeks 3-4)

### broker_connections
```sql
CREATE TABLE broker_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_id VARCHAR(50), -- 'zerodha', 'hdfc', 'moomoo', 'coinbase', etc
  name VARCHAR(100), -- custom name, e.g., "My Zerodha Account"
  status ENUM('connected', 'disconnected', 'expired', 'error') DEFAULT 'connected',
  credentials_encrypted TEXT NOT NULL, -- AES-256 encrypted { apiKey, apiSecret, ...}
  account_info JSONB, -- { userId, accountName, balance, }
  last_sync TIMESTAMP,
  sync_error TEXT,
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_status(status),
  UNIQUE(user_id, broker_id) -- one active connection per broker per user
);
```

### positions
```sql
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_connection_id UUID REFERENCES broker_connections(id) ON DELETE SET NULL,
  symbol VARCHAR(20) NOT NULL,
  market VARCHAR(10), -- 'US', 'NSE', 'CRYPTO', 'SGX', 'HKEX'
  quantity DECIMAL(20, 8) NOT NULL,
  entry_price DECIMAL(20, 8) NOT NULL,
  current_price DECIMAL(20, 8),
  position_type ENUM('long', 'short') DEFAULT 'long',
  status ENUM('open', 'closed') DEFAULT 'open',
  pnl DECIMAL(20, 2),
  pnl_percent DECIMAL(8, 2),
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_symbol(symbol),
  INDEX idx_status(status),
  INDEX idx_opened_at(opened_at)
);
```

### orders
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_connection_id UUID REFERENCES broker_connections(id),
  broker_order_id VARCHAR(100),
  symbol VARCHAR(20) NOT NULL,
  order_type ENUM('market', 'limit', 'stop', 'trailing_stop') DEFAULT 'market',
  side ENUM('buy', 'sell') NOT NULL,
  quantity DECIMAL(20, 8) NOT NULL,
  price DECIMAL(20, 8),
  status ENUM('pending', 'open', 'filled', 'partially_filled', 'cancelled', 'rejected') DEFAULT 'pending',
  filled_quantity DECIMAL(20, 8) DEFAULT 0,
  average_price DECIMAL(20, 8),
  signal_id UUID REFERENCES historical_signals(id),
  created_by_ai BOOLEAN DEFAULT FALSE,
  ai_confidence DECIMAL(5, 2),
  order_message TEXT,
  error_message TEXT,
  executed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_status(status),
  INDEX idx_symbol(symbol),
  INDEX idx_created_at(created_at)
);
```

### historical_signals
```sql
CREATE TABLE historical_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  market VARCHAR(10),
  signal_type ENUM('buy', 'sell', 'hold') NOT NULL,
  confidence DECIMAL(5, 2), -- 0-100
  timeframe VARCHAR(10), -- '15m', '1h', '4h', '1d'
  indicators JSONB, -- {rsi, macd, bb, volume, vwap, ...}
  analysis_text TEXT, -- AI-generated reasoning
  ai_model VARCHAR(50), -- 'claude-sonnet-4-5'
  ai_tokens_used INT,
  predicted_price DECIMAL(20, 8),
  predicted_price_high DECIMAL(20, 8),
  predicted_price_low DECIMAL(20, 8),
  entry_price DECIMAL(20, 8),
  stop_loss DECIMAL(20, 8),
  take_profit DECIMAL(20, 8),
  status ENUM('active', 'executed', 'expired', 'cancelled') DEFAULT 'active',
  actual_result JSONB, -- { finalPrice, pnl, pnlPercent, ... } set after execution
  execution_price DECIMAL(20, 8),
  executed_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_symbol(symbol),
  INDEX idx_status(status),
  INDEX idx_created_at(created_at),
  INDEX idx_expires_at(expires_at)
);
```

### signal_cache (fast reads)
```sql
CREATE TABLE signal_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) PRIMARY KEY,
  market VARCHAR(10),
  latest_signal_id UUID REFERENCES historical_signals(id),
  signal_data JSONB, -- full signal cached for fast dashboard access
  ttl_seconds INT DEFAULT 300,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_updated_at(updated_at)
);
```

### price_snapshots (analytics)
```sql
CREATE TABLE price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  market VARCHAR(10) NOT NULL,
  open DECIMAL(20, 8),
  high DECIMAL(20, 8),
  low DECIMAL(20, 8),
  close DECIMAL(20, 8),
  volume BIGINT,
  timeframe VARCHAR(10), -- '1m', '5m', '15m', '1h', '4h', '1d'
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_symbol_timeframe(symbol, timeframe),
  INDEX idx_timestamp(timestamp),
  UNIQUE(symbol, timeframe, timestamp)
);
```

## Phase 3: Billing & Subscriptions (Weeks 5-6)

### pricing_plans
```sql
CREATE TABLE pricing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL, -- 'Starter', 'Pro', 'Enterprise'
  tier VARCHAR(20) UNIQUE,
  description TEXT,
  price_monthly DECIMAL(10, 2),
  price_annual DECIMAL(10, 2),
  ai_analysis_credits INT, -- per month
  max_positions INT,
  max_watchlists INT,
  max_api_calls_per_minute INT,
  features JSONB, -- { "advanced_indicators": true, "portfolio_analytics": false, ...}
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### subscriptions
```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES pricing_plans(id),
  status ENUM('active', 'paused', 'cancelled', 'past_due') DEFAULT 'active',
  billing_cycle ENUM('monthly', 'annual') DEFAULT 'monthly',
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  payment_method VARCHAR(50), -- 'card', 'upi', 'bank_transfer'
  last_payment_id VARCHAR(100),
  auto_renew BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_status(status),
  INDEX idx_current_period_end(current_period_end)
);
```

### usage_metrics
```sql
CREATE TABLE usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  metric_name VARCHAR(50), -- 'ai_analyses', 'api_calls', 'orders_executed'
  usage_count INT DEFAULT 0,
  limit_count INT,
  billing_period_start TIMESTAMP,
  billing_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_metric(metric_name),
  INDEX idx_period(billing_period_start, billing_period_end)
);
```

### invoices
```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status ENUM('draft', 'sent', 'paid', 'failed', 'refunded') DEFAULT 'draft',
  payment_date TIMESTAMP,
  due_date TIMESTAMP,
  invoice_number VARCHAR(50) UNIQUE,
  pdf_url VARCHAR(255),
  metadata JSONB, -- {itemization, taxes, discounts}
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_status(status),
  INDEX idx_created_at(created_at)
);
```

### payments
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
  payment_method VARCHAR(50), -- 'stripe', 'razorpay', 'paypal'
  transaction_id VARCHAR(100),
  gateway_response JSONB,
  refund_amount DECIMAL(10, 2),
  refund_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_status(status),
  INDEX idx_created_at(created_at)
);
```

## Phase 4: Admin Management (Week 7)

### admin_users
```sql
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  role ENUM('super_admin', 'admin', 'support', 'finance') DEFAULT 'admin',
  permissions JSONB, -- granular permission list
  active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email(email),
  INDEX idx_role(role)
);
```

### support_tickets
```sql
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(255),
  description TEXT,
  category VARCHAR(50), -- 'billing', 'technical', 'broker_issue', 'feature_request'
  priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  status ENUM('open', 'in_progress', 'waiting_customer', 'resolved', 'closed') DEFAULT 'open',
  assigned_to UUID REFERENCES admin_users(id),
  resolution_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  INDEX idx_user_id(user_id),
  INDEX idx_status(status),
  INDEX idx_priority(priority)
);
```

### system_alerts
```sql
CREATE TABLE system_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(50), -- 'broker_down', 'high_error_rate', 'quota_exceeded'
  severity ENUM('info', 'warning', 'critical') DEFAULT 'warning',
  message TEXT,
  affected_users INT,
  status ENUM('active', 'acknowledged', 'resolved') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);
```

## Indexes & Performance Optimization

```sql
-- Composite indexes for common queries
CREATE INDEX idx_user_symbol ON positions(user_id, symbol);
CREATE INDEX idx_user_status ON subscriptions(user_id, status);
CREATE INDEX idx_user_broker ON broker_connections(user_id, broker_id);
CREATE INDEX idx_audit_user_action ON audit_logs(user_id, action, created_at DESC);

-- Partitioning strategy for large tables (Year 2+)
-- ALTER TABLE audit_logs PARTITION BY RANGE (YEAR(created_at)) ...
-- ALTER TABLE price_snapshots PARTITION BY RANGE (YEAR(timestamp)) ...
-- ALTER TABLE orders PARTITION BY RANGE (YEAR(created_at)) ...
```

## Encryption Strategy

- **Broker credentials**: AES-256-GCM encrypted before storage
- **KYC documents**: Encrypted with user-specific key + salt
- **API keys**: Hashed with bcrypt (one-way)
- **PII**: At-rest encryption, TLS in-transit
- **Encryption key management**: Environment variable in production, AWS KMS recommended for scale

## Backup & Disaster Recovery

- Daily automated backups to AWS S3 (encrypted)
- 30-day retention policy
- Point-in-time recovery capability
- Replica database in secondary region
