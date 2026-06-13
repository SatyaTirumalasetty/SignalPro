const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { db } = require('../config/database');
const { encryptCredentials, decryptCredentials } = require('../config/brokerEncryption');
const { getAdapter, getBrokerMeta, listBrokers } = require('../services/brokers/index');
const ZerodhaAdapter = require('../services/brokers/adapters/zerodha');
const SaxoAdapter    = require('../services/brokers/adapters/saxo');
const { syncConnection } = require('../services/brokerSync');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../config/logger');

const router = express.Router();
const REDIRECT_URI = `${process.env.API_BASE_URL || 'http://localhost:3001'}/api/brokers/oauth/callback`;
const MAX_CONNECTIONS = 10;

// ── GET /api/brokers/supported ────────────────────────────────────────────────

router.get('/supported', (req, res) => {
  res.json({ brokers: listBrokers() });
});

// ── GET /api/brokers/connections ──────────────────────────────────────────────

router.get('/connections', authenticate, asyncHandler(async (req, res) => {
  const connections = await db.manyOrNone(
    `SELECT id, broker_id, name, status, account_info, last_sync, sync_error,
            token_expires_at, connected_at, updated_at
     FROM broker_connections WHERE user_id = $1 ORDER BY connected_at DESC`,
    [req.user.id]
  );
  res.json({ connections });
}));

// ── POST /api/brokers/connect (API-key brokers) ───────────────────────────────

router.post('/connect', authenticate, [
  body('broker_id').notEmpty().withMessage('broker_id is required'),
  body('credentials').isObject().withMessage('credentials must be an object'),
  body('name').optional().trim().isLength({ max: 100 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { broker_id, credentials, name } = req.body;

  const meta = getBrokerMeta(broker_id);
  if (!meta) return res.status(400).json({ error: `Unknown broker: ${broker_id}` });
  if (meta.oauth_required) return res.status(400).json({ error: `${meta.name} requires OAuth. Use GET /api/brokers/${broker_id}/oauth/url` });

  const { count } = await db.one('SELECT COUNT(*) FROM broker_connections WHERE user_id = $1', [req.user.id]);
  if (parseInt(count) >= MAX_CONNECTIONS) return res.status(400).json({ error: 'Maximum broker connections reached' });

  // Validate credentials against the broker API
  const adapter = getAdapter(broker_id, credentials);
  let validation;
  try {
    validation = await adapter.validateCredentials();
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const encrypted = encryptCredentials(credentials);
  const id = uuidv4();
  const connectionName = name || meta.name;

  // Upsert: one connection per broker per user
  const conn = await db.one(
    `INSERT INTO broker_connections (id, user_id, broker_id, name, status, credentials_encrypted, account_info, connected_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'connected', $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, broker_id)
     DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted,
                   account_info = EXCLUDED.account_info, status = 'connected',
                   sync_error = NULL, connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     RETURNING id, broker_id, name, status, account_info, connected_at`,
    [id, req.user.id, broker_id, connectionName, encrypted, JSON.stringify(validation)]
  );

  res.status(201).json({ connection: conn });
}));

// ── GET /api/brokers/:brokerId/oauth/url ──────────────────────────────────────

router.get('/:brokerId/oauth/url', authenticate, [
  body('api_key').optional(),
], asyncHandler(async (req, res) => {
  const { brokerId } = req.params;
  const meta = getBrokerMeta(brokerId);
  if (!meta) return res.status(400).json({ error: `Unknown broker: ${brokerId}` });
  if (!meta.oauth_required) return res.status(400).json({ error: `${meta.name} does not use OAuth. Use POST /api/brokers/connect` });

  const { api_key, api_secret, client_id, client_secret, name } = req.query;

  const state = crypto.randomBytes(24).toString('hex');

  // Store state + temp credentials so we can complete OAuth in the callback
  const tempCreds = brokerId === 'zerodha'
    ? { api_key, api_secret }
    : { client_id, client_secret };

  await db.none(
    `INSERT INTO broker_oauth_states (user_id, broker_id, state, broker_name, temp_creds_encrypted, expires_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '15 minutes')`,
    [req.user.id, brokerId, state, name || meta.name, encryptCredentials(tempCreds)]
  );

  let url;
  if (brokerId === 'zerodha') {
    if (!api_key) return res.status(400).json({ error: 'api_key is required for Zerodha OAuth' });
    url = ZerodhaAdapter.getOAuthUrl(api_key);
  } else if (brokerId === 'saxo') {
    if (!client_id) return res.status(400).json({ error: 'client_id is required for Saxo OAuth' });
    url = SaxoAdapter.getOAuthUrl(client_id, REDIRECT_URI, state);
  }

  res.json({ url, state, note: 'Redirect user to `url`. The OAuth callback is handled automatically.' });
}));

// ── GET /api/brokers/oauth/callback ──────────────────────────────────────────

router.get('/oauth/callback', asyncHandler(async (req, res) => {
  const { state, request_token, code } = req.query;

  if (!state) return res.status(400).json({ error: 'Missing state parameter' });

  const oauthState = await db.oneOrNone(
    `SELECT * FROM broker_oauth_states WHERE state = $1 AND expires_at > CURRENT_TIMESTAMP`,
    [state]
  );
  if (!oauthState) return res.status(400).json({ error: 'Invalid or expired OAuth state' });

  // Consume state immediately (one-time use)
  await db.none('DELETE FROM broker_oauth_states WHERE id = $1', [oauthState.id]);

  const tempCreds = decryptCredentials(oauthState.temp_creds_encrypted);
  let credentials;

  try {
    if (oauthState.broker_id === 'zerodha') {
      if (!request_token) return res.status(400).json({ error: 'Missing request_token' });
      const tokens = await ZerodhaAdapter.exchangeToken(tempCreds.api_key, tempCreds.api_secret, request_token);
      credentials = { api_key: tempCreds.api_key, api_secret: tempCreds.api_secret, ...tokens };
    } else if (oauthState.broker_id === 'saxo') {
      if (!code) return res.status(400).json({ error: 'Missing authorization code' });
      const tokens = await SaxoAdapter.exchangeToken(tempCreds.client_id, tempCreds.client_secret, code, REDIRECT_URI);
      credentials = { client_id: tempCreds.client_id, client_secret: tempCreds.client_secret, ...tokens };
    } else {
      return res.status(400).json({ error: `OAuth not supported for broker: ${oauthState.broker_id}` });
    }
  } catch (err) {
    logger.error({ err: err.message }, 'OAuth token exchange failed');
    return res.status(502).json({ error: `OAuth failed: ${err.message}` });
  }

  // Validate and store connection
  const adapter = getAdapter(oauthState.broker_id, credentials);
  const validation = await adapter.validateCredentials().catch(() => ({}));

  const encrypted = encryptCredentials(credentials);
  const expiresAt = credentials.expires_at || null;

  await db.none(
    `INSERT INTO broker_connections (id, user_id, broker_id, name, status, credentials_encrypted, account_info, token_expires_at, connected_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'connected', $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, broker_id)
     DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted, account_info = EXCLUDED.account_info,
                   token_expires_at = EXCLUDED.token_expires_at, status = 'connected',
                   sync_error = NULL, connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
    [uuidv4(), oauthState.user_id, oauthState.broker_id, oauthState.broker_name, encrypted, JSON.stringify(validation), expiresAt]
  );

  // Redirect to frontend success page
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/brokers/connected?broker=${oauthState.broker_id}`);
}));

// ── GET /api/brokers/connections/:id ─────────────────────────────────────────

router.get('/connections/:id', authenticate, asyncHandler(async (req, res) => {
  const conn = await db.oneOrNone(
    `SELECT id, broker_id, name, status, account_info, last_sync, sync_error,
            token_expires_at, connected_at, disconnected_at, updated_at
     FROM broker_connections WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  res.json({ connection: conn });
}));

// ── PUT /api/brokers/connections/:id ─────────────────────────────────────────

router.put('/connections/:id', authenticate, [
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
], asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nothing to update' });

  const conn = await db.oneOrNone(
    `UPDATE broker_connections SET name = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND user_id = $3 RETURNING id, broker_id, name, status`,
    [name, req.params.id, req.user.id]
  );
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  res.json({ connection: conn });
}));

// ── DELETE /api/brokers/connections/:id ──────────────────────────────────────

router.delete('/connections/:id', authenticate, asyncHandler(async (req, res) => {
  const result = await db.result(
    `UPDATE broker_connections
     SET status = 'disconnected', disconnected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Connection not found' });
  res.json({ message: 'Broker disconnected' });
}));

// ── POST /api/brokers/connections/:id/sync ────────────────────────────────────

router.post('/connections/:id/sync', authenticate, asyncHandler(async (req, res) => {
  const conn = await db.oneOrNone(
    'SELECT id FROM broker_connections WHERE id = $1 AND user_id = $2 AND status = \'connected\'',
    [req.params.id, req.user.id]
  );
  if (!conn) return res.status(404).json({ error: 'Active connection not found' });

  syncConnection(req.params.id).catch(err =>
    logger.warn({ connectionId: req.params.id, err: err.message }, 'Manual sync failed')
  );

  res.json({ message: 'Sync started' });
}));

// ── POST /api/brokers/connections/:id/test ────────────────────────────────────

router.post('/connections/:id/test', authenticate, asyncHandler(async (req, res) => {
  const conn = await db.oneOrNone(
    'SELECT broker_id, credentials_encrypted FROM broker_connections WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  try {
    const credentials = decryptCredentials(conn.credentials_encrypted);
    const adapter = getAdapter(conn.broker_id, credentials);
    const result = await adapter.validateCredentials();
    res.json({ status: 'ok', details: result });
  } catch (err) {
    res.status(err.status || 502).json({ status: 'error', error: err.message });
  }
}));

// ── GET /api/brokers/connections/:id/accounts ─────────────────────────────────

router.get('/connections/:id/accounts', authenticate, asyncHandler(async (req, res) => {
  const conn = await db.oneOrNone(
    'SELECT broker_id, credentials_encrypted FROM broker_connections WHERE id = $1 AND user_id = $2 AND status = \'connected\'',
    [req.params.id, req.user.id]
  );
  if (!conn) return res.status(404).json({ error: 'Active connection not found' });

  const credentials = decryptCredentials(conn.credentials_encrypted);
  const adapter = getAdapter(conn.broker_id, credentials);
  const accountInfo = await adapter.getAccountInfo();
  res.json({ account: accountInfo });
}));

// ── GET /api/brokers/connections/:id/positions ────────────────────────────────

router.get('/connections/:id/positions', authenticate, asyncHandler(async (req, res) => {
  const conn = await db.oneOrNone(
    'SELECT broker_id, credentials_encrypted FROM broker_connections WHERE id = $1 AND user_id = $2 AND status = \'connected\'',
    [req.params.id, req.user.id]
  );
  if (!conn) return res.status(404).json({ error: 'Active connection not found' });

  const credentials = decryptCredentials(conn.credentials_encrypted);
  const adapter = getAdapter(conn.broker_id, credentials);
  const positions = await adapter.getPositions();
  res.json({ positions, count: positions.length });
}));

// ── GET /api/brokers/connections/:id/orders ───────────────────────────────────

router.get('/connections/:id/orders', authenticate, asyncHandler(async (req, res) => {
  const conn = await db.oneOrNone(
    'SELECT broker_id, credentials_encrypted FROM broker_connections WHERE id = $1 AND user_id = $2 AND status = \'connected\'',
    [req.params.id, req.user.id]
  );
  if (!conn) return res.status(404).json({ error: 'Active connection not found' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const credentials = decryptCredentials(conn.credentials_encrypted);
  const adapter = getAdapter(conn.broker_id, credentials);
  const orders = await adapter.getOrders(limit);
  res.json({ orders, count: orders.length });
}));

module.exports = router;
