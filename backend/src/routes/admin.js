const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
const isAdmin = [authenticate, requireRole('admin', 'super_admin')];

// ── User Management ───────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', isAdmin, [
  query('status').optional().isIn(['active', 'suspended', 'deleted']),
  query('kyc_status').optional().isIn(['pending', 'verified', 'rejected']),
  query('q').optional().trim().isLength({ max: 100 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, kyc_status, q, limit = 50, offset = 0 } = req.query;
  const params = [];
  let sql = `SELECT u.id, u.email, u.full_name, u.status, u.kyc_status, u.email_verified,
                    u.created_at, u.totp_enabled,
                    s.status as subscription_status, p.tier as plan_tier,
                    COUNT(DISTINCT bc.id) as broker_count
             FROM users u
             LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
             LEFT JOIN pricing_plans p ON s.plan_id = p.id
             LEFT JOIN broker_connections bc ON u.id = bc.user_id AND bc.status = 'connected'
             WHERE 1=1`;

  if (status)     { params.push(status);     sql += ` AND u.status = $${params.length}`; }
  if (kyc_status) { params.push(kyc_status); sql += ` AND u.kyc_status = $${params.length}`; }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    sql += ` AND (LOWER(u.email) LIKE $${params.length} OR LOWER(u.full_name) LIKE $${params.length})`;
  }
  sql += ` GROUP BY u.id, s.status, p.tier ORDER BY u.created_at DESC`;
  sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(parseInt(limit), parseInt(offset));

  const users = await db.manyOrNone(sql, params);
  const { count } = await db.one('SELECT COUNT(*) FROM users WHERE 1=1', []);

  res.json({ users, total: parseInt(count), limit: parseInt(limit), offset: parseInt(offset) });
}));

// GET /api/admin/users/:id
router.get('/users/:id', isAdmin, asyncHandler(async (req, res) => {
  const user = await db.oneOrNone(
    `SELECT u.*, s.status as subscription_status, p.name as plan_name, p.tier
     FROM users u
     LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
     LEFT JOIN pricing_plans p ON s.plan_id = p.id
     WHERE u.id = $1`,
    [req.params.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Remove sensitive fields
  delete user.password_hash;
  delete user.totp_secret;
  delete user.kyc_data;

  const recentActivity = await db.manyOrNone(
    `SELECT action, entity_type, status, created_at FROM audit_logs
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.params.id]
  );

  res.json({ user, recent_activity: recentActivity });
}));

// POST /api/admin/users/:id/suspend
router.post('/users/:id/suspend', isAdmin, [
  body('reason').optional().trim().isLength({ max: 500 }),
], asyncHandler(async (req, res) => {
  const user = await db.oneOrNone(
    `UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'active' RETURNING id, email, status`,
    [req.params.id]
  );
  if (!user) return res.status(404).json({ error: 'Active user not found' });
  res.json({ user, message: 'User suspended' });
}));

// DELETE /api/admin/users/:id/suspend
router.delete('/users/:id/suspend', isAdmin, asyncHandler(async (req, res) => {
  const user = await db.oneOrNone(
    `UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'suspended' RETURNING id, email, status`,
    [req.params.id]
  );
  if (!user) return res.status(404).json({ error: 'Suspended user not found' });
  res.json({ user, message: 'User unsuspended' });
}));

// POST /api/admin/users/:id/verify-kyc
router.post('/users/:id/verify-kyc', isAdmin, [
  body('status').isIn(['verified', 'rejected']),
  body('notes').optional().trim().isLength({ max: 500 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const user = await db.oneOrNone(
    `UPDATE users SET kyc_status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 RETURNING id, email, kyc_status`,
    [req.body.status, req.params.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user, message: `KYC ${req.body.status}` });
}));

// ── Billing Analytics ─────────────────────────────────────────────────────────

// GET /api/admin/billing/mrr — Monthly Recurring Revenue
router.get('/billing/mrr', isAdmin, asyncHandler(async (req, res) => {
  const mrr = await db.manyOrNone(
    `SELECT date_trunc('month', s.created_at) as month,
            SUM(CASE WHEN s.billing_cycle = 'monthly' THEN p.price_monthly
                     WHEN s.billing_cycle = 'annual'  THEN p.price_annual / 12
                     ELSE 0 END) as mrr,
            COUNT(*) as new_subs
     FROM subscriptions s
     JOIN pricing_plans p ON s.plan_id = p.id
     WHERE s.status IN ('active','past_due')
     GROUP BY date_trunc('month', s.created_at)
     ORDER BY month DESC LIMIT 12`
  );

  const currentMrr = await db.one(
    `SELECT SUM(CASE WHEN s.billing_cycle = 'monthly' THEN p.price_monthly
                     WHEN s.billing_cycle = 'annual'  THEN p.price_annual / 12
                     ELSE 0 END) as total
     FROM subscriptions s
     JOIN pricing_plans p ON s.plan_id = p.id
     WHERE s.status = 'active'`
  );

  res.json({ current_mrr: parseFloat(currentMrr.total || 0), monthly_breakdown: mrr });
}));

// GET /api/admin/billing/revenue-by-plan
router.get('/billing/revenue-by-plan', isAdmin, asyncHandler(async (req, res) => {
  const data = await db.manyOrNone(
    `SELECT p.name, p.tier, COUNT(s.id) as subscriber_count,
            SUM(CASE WHEN s.billing_cycle = 'monthly' THEN p.price_monthly
                     WHEN s.billing_cycle = 'annual'  THEN p.price_annual / 12
                     ELSE 0 END) as mrr
     FROM pricing_plans p
     LEFT JOIN subscriptions s ON p.id = s.plan_id AND s.status = 'active'
     GROUP BY p.id ORDER BY p.price_monthly ASC`
  );
  res.json({ plans: data });
}));

// ── Signal Performance ────────────────────────────────────────────────────────

// GET /api/admin/signals/performance
router.get('/signals/performance', isAdmin, asyncHandler(async (req, res) => {
  const bySymbol = await db.manyOrNone(
    `SELECT symbol, signal_type, COUNT(*) as total,
            AVG(confidence) as avg_confidence,
            SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) as executed
     FROM historical_signals
     GROUP BY symbol, signal_type
     ORDER BY total DESC LIMIT 20`
  );

  const overall = await db.one(
    `SELECT COUNT(*) as total, AVG(confidence) as avg_confidence,
            SUM(ai_tokens_used) as total_tokens,
            COUNT(DISTINCT user_id) as unique_users
     FROM historical_signals`
  );

  res.json({ by_symbol: bySymbol, overall });
}));

// ── Support Tickets ───────────────────────────────────────────────────────────

// GET /api/admin/support/tickets
router.get('/support/tickets', isAdmin, [
  query('status').optional().isIn(['open','in_progress','waiting_customer','resolved','closed']),
  query('priority').optional().isIn(['low','medium','high','critical']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { status, priority, limit = 25, offset = 0 } = req.query;
  const params = [];
  let sql = `SELECT t.*, u.email as user_email, u.full_name as user_name
             FROM support_tickets t
             LEFT JOIN users u ON t.user_id = u.id WHERE 1=1`;

  if (status)   { params.push(status);   sql += ` AND t.status = $${params.length}`; }
  if (priority) { params.push(priority); sql += ` AND t.priority = $${params.length}`; }
  sql += ` ORDER BY t.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(parseInt(limit), parseInt(offset));

  const tickets = await db.manyOrNone(sql, params);
  const { count } = await db.one('SELECT COUNT(*) FROM support_tickets', []);

  res.json({ tickets, total: parseInt(count) });
}));

// POST /api/admin/support/tickets/:id/assign
router.post('/support/tickets/:id/assign', isAdmin, [
  body('admin_id').isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const ticket = await db.oneOrNone(
    `UPDATE support_tickets SET assigned_to = $1, status = 'in_progress'
     WHERE id = $2 RETURNING *`,
    [req.body.admin_id, req.params.id]
  );
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ ticket });
}));

// POST /api/admin/support/tickets/:id/resolve
router.post('/support/tickets/:id/resolve', isAdmin, [
  body('resolution_notes').trim().notEmpty(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const ticket = await db.oneOrNone(
    `UPDATE support_tickets SET status = 'resolved', resolution_notes = $1,
            resolved_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
    [req.body.resolution_notes, req.params.id]
  );
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ ticket });
}));

// ── System Health ─────────────────────────────────────────────────────────────

// GET /api/admin/system/health
router.get('/system/health', isAdmin, asyncHandler(async (req, res) => {
  const [userCount, activeSubscriptions, openTickets, brokerConns, recentErrors] = await Promise.all([
    db.one('SELECT COUNT(*) FROM users WHERE status = \'active\''),
    db.one('SELECT COUNT(*) FROM subscriptions WHERE status = \'active\''),
    db.one('SELECT COUNT(*) FROM support_tickets WHERE status IN (\'open\',\'in_progress\')'),
    db.one('SELECT COUNT(*) FROM broker_connections WHERE status = \'connected\''),
    db.manyOrNone(`SELECT action, entity_type, error_message, created_at FROM audit_logs
                   WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`),
  ]);

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    metrics: {
      active_users: parseInt(userCount.count),
      active_subscriptions: parseInt(activeSubscriptions.count),
      open_support_tickets: parseInt(openTickets.count),
      connected_brokers: parseInt(brokerConns.count),
    },
    recent_errors: recentErrors,
  });
}));

// GET /api/admin/system/alerts
router.get('/system/alerts', isAdmin, asyncHandler(async (req, res) => {
  const alerts = await db.manyOrNone(
    `SELECT * FROM system_alerts WHERE status != 'resolved'
     ORDER BY created_at DESC LIMIT 50`
  );
  res.json({ alerts });
}));

// POST /api/admin/system/alerts
router.post('/system/alerts', isAdmin, [
  body('alert_type').trim().notEmpty(),
  body('severity').isIn(['info','warning','critical']),
  body('message').trim().notEmpty(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const alert = await db.one(
    `INSERT INTO system_alerts (alert_type, severity, message)
     VALUES ($1, $2, $3) RETURNING *`,
    [req.body.alert_type, req.body.severity, req.body.message]
  );
  res.status(201).json({ alert });
}));

// ── User-facing support ticket creation ───────────────────────────────────────

// POST /api/admin/tickets — users create tickets
router.post('/tickets', authenticate, [
  body('title').trim().notEmpty().isLength({ max: 255 }),
  body('description').trim().notEmpty(),
  body('category').isIn(['billing','technical','broker_issue','feature_request']),
  body('priority').optional().isIn(['low','medium','high']),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, description, category, priority = 'medium' } = req.body;
  const ticket = await db.one(
    `INSERT INTO support_tickets (user_id, title, description, category, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, title, description, category, priority]
  );
  res.status(201).json({ ticket });
}));

// GET /api/admin/tickets/mine — user's own tickets
router.get('/tickets/mine', authenticate, asyncHandler(async (req, res) => {
  const tickets = await db.manyOrNone(
    `SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ tickets });
}));

module.exports = router;
