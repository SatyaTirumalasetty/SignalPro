-- Phase 1 additions: 2FA, email verification, password reset
-- For existing databases; fresh installs use init.sql which already includes these.
-- Run: psql -U postgres -d signalpro -f migrations/001_phase1_additions.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64),
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        VARCHAR(64) UNIQUE NOT NULL,
  expires_at   TIMESTAMP NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_evt_user_id   ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_token     ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_evt_expires   ON email_verification_tokens(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64) UNIQUE NOT NULL,
  expires_at   TIMESTAMP NOT NULL,
  used         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_expires    ON password_reset_tokens(expires_at);
