-- Phase 2: Broker integration additions
-- Run: psql -U postgres -d signalpro -f migrations/002_phase2_additions.sql

-- Temporary state store for OAuth flows (CSRF protection)
CREATE TABLE IF NOT EXISTS broker_oauth_states (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_id    VARCHAR(50) NOT NULL,
  state        VARCHAR(64) UNIQUE NOT NULL,
  broker_name  VARCHAR(100),
  temp_creds_encrypted TEXT,  -- encrypted {api_key, api_secret} for OAuth brokers
  expires_at   TIMESTAMP NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_state   ON broker_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON broker_oauth_states(expires_at);

-- Track sync history for monitoring / debugging
CREATE TABLE IF NOT EXISTS broker_sync_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_connection_id UUID NOT NULL REFERENCES broker_connections(id) ON DELETE CASCADE,
  sync_type            VARCHAR(50) NOT NULL,  -- 'account_info' | 'positions' | 'orders' | 'token_refresh'
  status               VARCHAR(20) NOT NULL,  -- 'success' | 'failed'
  records_synced       INT DEFAULT 0,
  error_message        TEXT,
  duration_ms          INT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_connection ON broker_sync_logs(broker_connection_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created    ON broker_sync_logs(created_at DESC);

-- Token expiry field for proactive refresh scheduling
ALTER TABLE broker_connections
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP;
