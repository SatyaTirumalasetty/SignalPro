const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');

const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/users/me — full profile from DB
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await db.oneOrNone(
    `SELECT id, email, full_name, phone, country, status, email_verified,
            totp_enabled, kyc_status, preferences, created_at, updated_at
     FROM users WHERE id = $1 AND status != 'deleted'`,
    [req.user.id]
  );

  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ user });
}));

// PUT /api/users/me — update profile fields
router.put('/me', authenticate, [
  body('full_name').optional().trim().notEmpty().isLength({ max: 255 }),
  body('phone').optional().trim().matches(/^\+?[\d\s\-()\\.]{7,20}$/),
  body('country').optional().trim().isISO31661Alpha2(),
  body('preferences').optional().isObject(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { full_name, phone, country, preferences } = req.body;
  const updates = [];
  const values = [req.user.id];

  if (full_name !== undefined) { values.push(full_name);                   updates.push(`full_name = $${values.length}`); }
  if (phone     !== undefined) { values.push(phone);                       updates.push(`phone = $${values.length}`); }
  if (country   !== undefined) { values.push(country.toUpperCase());       updates.push(`country = $${values.length}`); }
  if (preferences !== undefined) { values.push(JSON.stringify(preferences)); updates.push(`preferences = $${values.length}::jsonb`); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const user = await db.oneOrNone(
    `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status != 'deleted'
     RETURNING id, email, full_name, phone, country, preferences, updated_at`,
    values
  );

  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ user });
}));

// PUT /api/users/me/password — change password (requires current password)
router.put('/me/password', authenticate, [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { current_password, new_password } = req.body;

  const user = await db.oneOrNone(
    'SELECT id, password_hash FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!(await bcrypt.compare(current_password, user.password_hash))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hashed = await bcrypt.hash(new_password, 12);

  await db.tx(async t => {
    await t.none(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashed, user.id]
    );
    // Invalidate all sessions so the user must log in again
    await t.none('DELETE FROM user_sessions WHERE user_id = $1', [user.id]);
  });

  res.json({ message: 'Password changed. Please log in again.' });
}));

// GET /api/users/me/sessions — list active sessions
router.get('/me/sessions', authenticate, asyncHandler(async (req, res) => {
  const sessions = await db.manyOrNone(
    `SELECT id, ip_address, user_agent, device_name, last_activity, created_at, expires_at
     FROM user_sessions
     WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
     ORDER BY last_activity DESC NULLS LAST`,
    [req.user.id]
  );
  res.json({ sessions });
}));

// DELETE /api/users/me/sessions/:id — revoke a specific session
router.delete('/me/sessions/:id', authenticate, asyncHandler(async (req, res) => {
  const result = await db.result(
    'DELETE FROM user_sessions WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({ message: 'Session revoked' });
}));

// DELETE /api/users/me/sessions — revoke all sessions (sign out everywhere)
router.delete('/me/sessions', authenticate, asyncHandler(async (req, res) => {
  await db.none('DELETE FROM user_sessions WHERE user_id = $1', [req.user.id]);
  res.json({ message: 'All sessions revoked' });
}));

module.exports = router;
