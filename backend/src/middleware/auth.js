const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../config/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-minimum-64-chars-change-immediately!!!';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-64-chars-minimum!!!';

function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role || 'user' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '24h' }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id },
    JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
}

function generateTwoFaToken(userId) {
  return jwt.sign({ id: userId, two_fa_pending: true }, JWT_SECRET, { expiresIn: '5m' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch {
    return null;
  }
}

function verifyTwoFaToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.two_fa_pending === true ? decoded : null;
  } catch {
    return null;
  }
}

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const user = verifyToken(token);
  if (!user || user.two_fa_pending) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      logger.warn(`Unauthorized access attempt by ${req.user.id} for role ${req.user.role}`);
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    const user = verifyToken(token);
    if (user && !user.two_fa_pending) req.user = user;
  }
  next();
}

async function authenticateApiKey(req, res, next) {
  const rawKey = req.headers['x-api-key'];
  if (!rawKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const { db } = require('../config/database');

  const key = await db.oneOrNone(
    `SELECT ak.user_id, ak.scope, ak.rate_limit, ak.id
     FROM api_keys ak
     WHERE ak.key_hash = $1
       AND ak.active = TRUE
       AND (ak.expires_at IS NULL OR ak.expires_at > CURRENT_TIMESTAMP)`,
    [keyHash]
  ).catch(() => null);

  if (!key) {
    return res.status(401).json({ error: 'Invalid or expired API key' });
  }

  // Update usage metadata asynchronously — don't block the request
  db.none(
    'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP, last_ip = $1 WHERE id = $2',
    [req.ip, key.id]
  ).catch(() => {});

  const user = await db.oneOrNone(
    'SELECT id, email, role, status FROM users WHERE id = $1',
    [key.user_id]
  ).catch(() => null);

  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Account inactive' });
  }

  req.user = { id: user.id, email: user.email, role: user.role, api_key_scope: key.scope };
  next();
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTwoFaToken,
  verifyToken,
  verifyRefreshToken,
  verifyTwoFaToken,
  authenticate,
  requireRole,
  optionalAuth,
  authenticateApiKey,
};
