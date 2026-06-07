-- The users table is missing a `role` column that auth/login code (src/routes/auth.js,
-- src/middleware/auth.js) selects and embeds in JWTs, defaulting to 'user'. Without it,
-- every login query fails with `column "role" does not exist` (42703), blocking all sign-ins.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
