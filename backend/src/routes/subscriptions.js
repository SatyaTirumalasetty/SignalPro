const express = require('express');
const { body, validationResult } = require('express-validator');
const billing = require('../services/billingService');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/subscriptions/me
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const sub = await billing.getUserSubscription(req.user.id);
  if (!sub) return res.json({ subscription: null, message: 'No active subscription' });
  res.json({ subscription: sub });
}));

// POST /api/subscriptions/create
router.post('/create', authenticate, [
  body('plan_id').isUUID().withMessage('plan_id must be a valid UUID'),
  body('billing_cycle').isIn(['monthly', 'annual']),
  body('payment_method').optional().isIn(['card', 'upi', 'bank_transfer', 'stripe', 'razorpay']),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { plan_id, billing_cycle, payment_method = 'stripe' } = req.body;

  // Check plan exists
  const plan = await billing.getPlan(null);
  const plans = await billing.getPlans();
  const validPlan = plans.find(p => p.id === plan_id);
  if (!validPlan) return res.status(404).json({ error: 'Pricing plan not found' });

  // Check for existing active subscription
  const existing = await billing.getUserSubscription(req.user.id);
  if (existing) return res.status(409).json({ error: 'Active subscription exists. Use /change-plan to switch.' });

  const sub = await billing.createSubscription(req.user.id, plan_id, billing_cycle, payment_method);
  res.status(201).json({ subscription: sub, message: `Subscribed to ${validPlan.name}` });
}));

// POST /api/subscriptions/:id/change-plan
router.post('/:id/change-plan', authenticate, [
  body('plan_id').isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const plans = await billing.getPlans();
  const newPlan = plans.find(p => p.id === req.body.plan_id);
  if (!newPlan) return res.status(404).json({ error: 'Plan not found' });

  const sub = await billing.changePlan(req.params.id, req.user.id, req.body.plan_id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  res.json({ subscription: sub, message: `Plan changed to ${newPlan.name}` });
}));

// POST /api/subscriptions/:id/cancel
router.post('/:id/cancel', authenticate, [
  body('immediately').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const immediately = req.body.immediately === true;
  const sub = await billing.cancelSubscription(req.params.id, req.user.id, immediately);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  res.json({
    subscription: sub,
    message: immediately
      ? 'Subscription cancelled immediately'
      : 'Subscription will cancel at period end',
  });
}));

// POST /api/subscriptions/:id/reactivate
router.post('/:id/reactivate', authenticate, asyncHandler(async (req, res) => {
  const { db } = require('../config/database');
  const sub = await db.oneOrNone(
    `UPDATE subscriptions SET cancel_at_period_end = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!sub) return res.status(404).json({ error: 'Subscription not found or not cancellable' });
  res.json({ subscription: sub, message: 'Subscription reactivated' });
}));

module.exports = router;
