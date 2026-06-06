const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const { db } = require('../config/database');
const {
  generateAccessToken,
  generateRefreshToken,
  generateTwoFaToken,
  verifyRefreshToken,
  verifyTwoFaToken,
  authenticate,
} = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const logger = require('../config/logger');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────

async function createSession(userId, accessToken, req) {
  const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  await db.none(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '24 hours', CURRENT_TIMESTAMP)`,
    [userId, tokenHash, req.ip, req.get('user-agent')]
  );
}

// ─── Register ─────────────────────────────────────────────────

router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('full_name').trim().notEmpty().withMessage('Full name is required'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password, full_name } = req.body;

  const existing = await db.oneOrNone('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const userId = uuidv4();

  const user = await db.one(
    `INSERT INTO users (id, email, password_hash, full_name, status, kyc_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING id, email, full_name, status`,
    [userId, email, hashedPassword, full_name]
  );

  // Create email verification token
  const token = crypto.randomBytes(32).toString('hex');
  await db.none(
    `INSERT INTO email_verification_tokens (user_id, token, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours')`,
    [userId, token]
  );

  sendVerificationEmail(email, token).catch(err =>
    logger.warn({ err: err.message }, 'Failed to send verification email')
  );

  res.status(201).json({
    user: { id: user.id, email: user.email, full_name: user.full_name },
    message: 'Registration successful. Check your email to verify your account.',
  });
}));

// ─── Login ────────────────────────────────────────────────────

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  const user = await db.oneOrNone(
    `SELECT id, email, password_hash, full_name, role, status, totp_enabled, totp_secret
     FROM users WHERE email = $1`,
    [email]
  );

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Account suspended' });
  }

  if (user.totp_enabled) {
    const twoFaToken = generateTwoFaToken(user.id);
    return res.json({ requires_2fa: true, two_fa_token: twoFaToken });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await createSession(user.id, accessToken, req);

  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
  });
}));

// ─── 2FA Challenge (complete login when 2FA is enabled) ───────

router.post('/2fa/challenge', [
  body('two_fa_token').notEmpty(),
  body('totp_code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Invalid TOTP code'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { two_fa_token, totp_code } = req.body;

  const decoded = verifyTwoFaToken(two_fa_token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired 2FA token' });
  }

  const user = await db.oneOrNone(
    'SELECT id, email, full_name, role, status, totp_secret, totp_enabled FROM users WHERE id = $1',
    [decoded.id]
  );

  if (!user || !user.totp_enabled || !user.totp_secret) {
    return res.status(401).json({ error: 'Invalid request' });
  }

  if (!authenticator.verify({ token: totp_code, secret: user.totp_secret })) {
    return res.status(401).json({ error: 'Invalid authenticator code' });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await createSession(user.id, accessToken, req);

  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
  });
}));

// ─── Refresh Token ────────────────────────────────────────────

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid refresh token' });
  }

  const user = await db.oneOrNone(
    'SELECT id, email, full_name, role FROM users WHERE id = $1',
    [decoded.id]
  );
  if (!user) {
    return res.status(403).json({ error: 'User not found' });
  }

  res.json({ accessToken: generateAccessToken(user) });
}));

// ─── Logout ───────────────────────────────────────────────────

router.post('/logout', asyncHandler(async (req, res) => {
  if (req.user) {
    await db.none(
      'DELETE FROM user_sessions WHERE user_id = $1 AND expires_at < CURRENT_TIMESTAMP',
      [req.user.id]
    );
  }
  res.json({ message: 'Logged out' });
}));

// ─── Email Verification ───────────────────────────────────────

router.post('/verify-email', [
  body('token').notEmpty(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const record = await db.oneOrNone(
    `SELECT user_id FROM email_verification_tokens
     WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP`,
    [req.body.token]
  );

  if (!record) {
    return res.status(400).json({ error: 'Invalid or expired verification token' });
  }

  await db.tx(async t => {
    await t.none(
      'UPDATE users SET email_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [record.user_id]
    );
    await t.none('DELETE FROM email_verification_tokens WHERE user_id = $1', [record.user_id]);
  });

  res.json({ message: 'Email verified successfully' });
}));

router.post('/resend-verification', authenticate, asyncHandler(async (req, res) => {
  const user = await db.oneOrNone(
    'SELECT id, email, email_verified FROM users WHERE id = $1',
    [req.user.id]
  );

  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });

  await db.none('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);

  const token = crypto.randomBytes(32).toString('hex');
  await db.none(
    `INSERT INTO email_verification_tokens (user_id, token, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours')`,
    [user.id, token]
  );

  await sendVerificationEmail(user.email, token);
  res.json({ message: 'Verification email sent' });
}));

// ─── Password Reset ───────────────────────────────────────────

router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Always respond the same way to prevent email enumeration
  const user = await db.oneOrNone('SELECT id FROM users WHERE email = $1', [req.body.email]);

  if (user) {
    await db.none('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await db.none(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
      [user.id, tokenHash]
    );

    sendPasswordResetEmail(req.body.email, rawToken).catch(err =>
      logger.warn({ err: err.message }, 'Failed to send password reset email')
    );
  }

  res.json({ message: "If that email is registered, a reset link has been sent." });
}));

router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { token, password } = req.body;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const record = await db.oneOrNone(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP AND used = FALSE`,
    [tokenHash]
  );

  if (!record) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.tx(async t => {
    await t.none(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, record.user_id]
    );
    await t.none('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [record.id]);
    // Invalidate all sessions after password change
    await t.none('DELETE FROM user_sessions WHERE user_id = $1', [record.user_id]);
  });

  res.json({ message: 'Password reset successfully. Please log in again.' });
}));

// ─── 2FA Setup & Management ───────────────────────────────────

router.post('/2fa/setup', authenticate, asyncHandler(async (req, res) => {
  const user = await db.oneOrNone(
    'SELECT id, email, totp_enabled FROM users WHERE id = $1',
    [req.user.id]
  );

  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(user.email, 'SignalPro', secret);
  const qrCode = await QRCode.toDataURL(otpauthUrl);

  // Store the secret; totp_enabled stays false until /2fa/enable is called
  await db.none(
    'UPDATE users SET totp_secret = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [secret, user.id]
  );

  res.json({ secret, otpauth_url: otpauthUrl, qr_code: qrCode });
}));

router.post('/2fa/enable', authenticate, [
  body('totp_code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Invalid TOTP code'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const user = await db.oneOrNone(
    'SELECT id, totp_secret, totp_enabled FROM users WHERE id = $1',
    [req.user.id]
  );

  if (!user || !user.totp_secret) {
    return res.status(400).json({ error: 'Call POST /2fa/setup first' });
  }
  if (user.totp_enabled) {
    return res.status(400).json({ error: '2FA is already enabled' });
  }

  if (!authenticator.verify({ token: req.body.totp_code, secret: user.totp_secret })) {
    return res.status(400).json({ error: 'Invalid authenticator code' });
  }

  await db.none(
    'UPDATE users SET totp_enabled = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [user.id]
  );

  res.json({ message: '2FA enabled successfully' });
}));

router.delete('/2fa', authenticate, [
  body('totp_code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Invalid TOTP code'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const user = await db.oneOrNone(
    'SELECT id, totp_secret, totp_enabled FROM users WHERE id = $1',
    [req.user.id]
  );

  if (!user || !user.totp_enabled) {
    return res.status(400).json({ error: '2FA is not enabled' });
  }

  if (!authenticator.verify({ token: req.body.totp_code, secret: user.totp_secret })) {
    return res.status(401).json({ error: 'Invalid authenticator code' });
  }

  await db.none(
    'UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [user.id]
  );

  res.json({ message: '2FA disabled' });
}));

module.exports = router;
