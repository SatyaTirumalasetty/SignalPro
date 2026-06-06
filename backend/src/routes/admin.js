const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

// TODO: Implement admin dashboard
// - User management
// - Billing analytics
// - Signal performance
// - Support tickets
// - System health

router.get('/users', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  res.json({ users: [] });
});

module.exports = router;
