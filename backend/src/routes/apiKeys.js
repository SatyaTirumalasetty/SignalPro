const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { db } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const KEY_PREFIX = process.env.API_KEY_PREFIX || 'sp_live_';
const KEY_BYTES  = Math.max(16, parseInt(process.env.API_KEY_LENGTH) || 32);
const MAX_KEYS   = 10;

function generateRawKey() {
  return KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString('hex');
}

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// GET /api/api-keys — list keys (never returns the raw key)
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const keys = await db.manyOrNone(
    `SELECT id, name, last_used_at, last_ip, rate_limit, scope, active, created_at, expires_at
     FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ api_keys: keys });
}));

// POST /api/api-keys — create a new key (raw key returned ONCE)
router.post('/', authenticate, [
  body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Name is required (max 100 chars)'),
  body('scope').optional().isArray(),
  body('expires_in_days').optional().isInt({ min: 1, max: 365 }).withMessage('expires_in_days must be 1–365'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, scope = [], expires_in_days } = req.body;

  const { count } = await db.one(
    'SELECT COUNT(*) FROM api_keys WHERE user_id = $1 AND active = TRUE',
    [req.user.id]
  );
  if (parseInt(count) >= MAX_KEYS) {
    return res.status(400).json({ error: `Maximum of ${MAX_KEYS} active API keys allowed` });
  }

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const id = uuidv4();
  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 86_400_000)
    : null;

  await db.none(
    `INSERT INTO api_keys (id, user_id, key_hash, name, scope, active, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, CURRENT_TIMESTAMP, $6)`,
    [id, req.user.id, keyHash, name, JSON.stringify(scope), expiresAt]
  );

  res.status(201).json({
    api_key: { id, name, key: rawKey, scope, created_at: new Date(), expires_at: expiresAt },
    warning: 'Save this key now — it will not be shown again.',
  });
}));

// DELETE /api/api-keys/:id — revoke a key
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const result = await db.result(
    'UPDATE api_keys SET active = FALSE WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'API key not found' });
  }

  res.json({ message: 'API key revoked' });
}));

// POST /api/api-keys/:id/rotate — revoke old key and issue a new one with the same settings
router.post('/:id/rotate', authenticate, asyncHandler(async (req, res) => {
  const existing = await db.oneOrNone(
    `SELECT id, name, scope, rate_limit, expires_at
     FROM api_keys WHERE id = $1 AND user_id = $2 AND active = TRUE`,
    [req.params.id, req.user.id]
  );

  if (!existing) {
    return res.status(404).json({ error: 'API key not found' });
  }

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const newId = uuidv4();

  await db.tx(async t => {
    await t.none('UPDATE api_keys SET active = FALSE WHERE id = $1', [existing.id]);
    await t.none(
      `INSERT INTO api_keys (id, user_id, key_hash, name, scope, rate_limit, active, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, CURRENT_TIMESTAMP, $7)`,
      [newId, req.user.id, keyHash, existing.name, existing.scope, existing.rate_limit, existing.expires_at]
    );
  });

  res.json({
    api_key: { id: newId, name: existing.name, key: rawKey, created_at: new Date() },
    warning: 'Save this key now — it will not be shown again.',
  });
}));

module.exports = router;
