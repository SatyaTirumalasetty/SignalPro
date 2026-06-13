const request = require('supertest');
const express = require('express');
const { generateAccessToken } = require('../../middleware/auth');

const mockDb = {
  one: jest.fn(),
  oneOrNone: jest.fn(),
  manyOrNone: jest.fn(),
  none: jest.fn(),
};
jest.mock('../../config/database', () => ({ db: mockDb }));

const router = require('../../routes/admin');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const ADMIN_ID  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID   = 'user-uuid-001';
const TICKET_ID = 'ticket-uuid-001';

const adminToken = generateAccessToken({ id: ADMIN_ID, email: 'admin@test.com', role: 'admin' });
const userToken  = generateAccessToken({ id: USER_ID,  email: 'user@test.com',  role: 'user'  });
const adminAuth  = `Bearer ${adminToken}`;
const userAuth   = `Bearer ${userToken}`;

const MOCK_USER = {
  id: USER_ID, email: 'user@test.com', full_name: 'Test User',
  status: 'active', kyc_status: 'pending', email_verified: true,
  created_at: new Date().toISOString(), totp_enabled: false,
  subscription_status: null, plan_tier: null, broker_count: '0',
};

const MOCK_TICKET = {
  id: TICKET_ID, user_id: USER_ID, title: 'Help needed',
  description: 'Cannot connect broker', category: 'broker_issue',
  priority: 'medium', status: 'open', created_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.none.mockResolvedValue(undefined);
});

const app = createApp();

// ── Auth guard ────────────────────────────────────────────────────────────────
describe('Admin auth guard', () => {
  test('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  test('returns 403 for non-admin user', async () => {
    const res = await request(app).get('/api/admin/users').set('Authorization', userAuth);
    expect(res.status).toBe(403);
  });

  test('allows admin user access', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([MOCK_USER]);
    mockDb.one.mockResolvedValueOnce({ count: '1' });
    const res = await request(app).get('/api/admin/users').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
  });
});

// ── User Management ───────────────────────────────────────────────────────────
describe('GET /api/admin/users', () => {
  test('returns paginated user list', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([MOCK_USER]);
    mockDb.one.mockResolvedValueOnce({ count: '1' });
    const res = await request(app).get('/api/admin/users').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.total).toBe(1);
  });

  test('returns 400 for invalid status filter', async () => {
    const res = await request(app)
      .get('/api/admin/users?status=invalid')
      .set('Authorization', adminAuth);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/users/:id', () => {
  test('returns user details with recent activity', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_USER, password_hash: 'hashed', totp_secret: 'secret' });
    mockDb.manyOrNone.mockResolvedValueOnce([]);
    const res = await request(app).get(`/api/admin/users/${USER_ID}`).set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.user.totp_secret).toBeUndefined();
    expect(Array.isArray(res.body.recent_activity)).toBe(true);
  });

  test('returns 404 for unknown user', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/admin/users/nonexistent').set('Authorization', adminAuth);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/users/:id/suspend', () => {
  test('suspends active user', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_USER, status: 'suspended' });
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/suspend`)
      .set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/suspended/i);
  });

  test('returns 404 when user not active', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/admin/users/nonexistent/suspend')
      .set('Authorization', adminAuth);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/users/:id/suspend', () => {
  test('unsuspends suspended user', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_USER, status: 'active' });
    const res = await request(app)
      .delete(`/api/admin/users/${USER_ID}/suspend`)
      .set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/unsuspended/i);
  });
});

describe('POST /api/admin/users/:id/verify-kyc', () => {
  test('approves KYC', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_USER, kyc_status: 'verified' });
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/verify-kyc`)
      .set('Authorization', adminAuth)
      .send({ status: 'verified' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);
  });

  test('rejects KYC', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_USER, kyc_status: 'rejected' });
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/verify-kyc`)
      .set('Authorization', adminAuth)
      .send({ status: 'rejected' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/rejected/i);
  });

  test('returns 400 for invalid status', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/verify-kyc`)
      .set('Authorization', adminAuth)
      .send({ status: 'approved' });
    expect(res.status).toBe(400);
  });
});

// ── Billing Analytics ─────────────────────────────────────────────────────────
describe('GET /api/admin/billing/mrr', () => {
  test('returns current MRR and monthly breakdown', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([{ month: '2024-01', mrr: '2997', new_subs: '30' }]);
    mockDb.one.mockResolvedValueOnce({ total: '2997.00' });
    const res = await request(app).get('/api/admin/billing/mrr').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(typeof res.body.current_mrr).toBe('number');
    expect(Array.isArray(res.body.monthly_breakdown)).toBe(true);
  });
});

describe('GET /api/admin/billing/revenue-by-plan', () => {
  test('returns revenue breakdown by plan', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([
      { name: 'Starter', tier: 'starter', subscriber_count: '10', mrr: '299.90' },
    ]);
    const res = await request(app).get('/api/admin/billing/revenue-by-plan').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plans)).toBe(true);
  });
});

// ── Signal Performance ────────────────────────────────────────────────────────
describe('GET /api/admin/signals/performance', () => {
  test('returns signal performance stats', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([{ symbol: 'AAPL', signal_type: 'buy', total: '5' }]);
    mockDb.one.mockResolvedValueOnce({ total: '50', avg_confidence: '65', total_tokens: '50000', unique_users: '10' });
    const res = await request(app).get('/api/admin/signals/performance').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.by_symbol)).toBe(true);
    expect(res.body.overall).toBeDefined();
  });
});

// ── Support Tickets ───────────────────────────────────────────────────────────
describe('GET /api/admin/support/tickets', () => {
  test('returns ticket list', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([MOCK_TICKET]);
    mockDb.one.mockResolvedValueOnce({ count: '1' });
    const res = await request(app).get('/api/admin/support/tickets').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  test('returns 400 for invalid priority filter', async () => {
    const res = await request(app)
      .get('/api/admin/support/tickets?priority=urgent')
      .set('Authorization', adminAuth);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/support/tickets/:id/assign', () => {
  test('assigns ticket to admin', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_TICKET, assigned_to: ADMIN_ID, status: 'in_progress' });
    const res = await request(app)
      .post(`/api/admin/support/tickets/${TICKET_ID}/assign`)
      .set('Authorization', adminAuth)
      .send({ admin_id: ADMIN_ID });
    expect(res.status).toBe(200);
    expect(res.body.ticket).toBeDefined();
  });

  test('returns 404 for unknown ticket', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/admin/support/tickets/nonexistent/assign')
      .set('Authorization', adminAuth)
      .send({ admin_id: ADMIN_ID });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/support/tickets/:id/resolve', () => {
  test('resolves ticket with notes', async () => {
    mockDb.oneOrNone.mockResolvedValueOnce({ ...MOCK_TICKET, status: 'resolved' });
    const res = await request(app)
      .post(`/api/admin/support/tickets/${TICKET_ID}/resolve`)
      .set('Authorization', adminAuth)
      .send({ resolution_notes: 'Issue fixed by reconnecting broker.' });
    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe('resolved');
  });

  test('returns 400 for missing resolution_notes', async () => {
    const res = await request(app)
      .post(`/api/admin/support/tickets/${TICKET_ID}/resolve`)
      .set('Authorization', adminAuth)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── System Health ─────────────────────────────────────────────────────────────
describe('GET /api/admin/system/health', () => {
  test('returns system health metrics', async () => {
    mockDb.one
      .mockResolvedValueOnce({ count: '100' })
      .mockResolvedValueOnce({ count: '45' })
      .mockResolvedValueOnce({ count: '3' })
      .mockResolvedValueOnce({ count: '30' });
    mockDb.manyOrNone.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/admin/system/health').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.metrics.active_users).toBe(100);
    expect(res.body.metrics.active_subscriptions).toBe(45);
    expect(res.body.timestamp).toBeDefined();
  });
});

// ── User-facing support ticket creation ───────────────────────────────────────
describe('POST /api/admin/tickets (user creates ticket)', () => {
  test('allows regular user to create support ticket', async () => {
    mockDb.one.mockResolvedValueOnce({ ...MOCK_TICKET });
    const res = await request(app)
      .post('/api/admin/tickets')
      .set('Authorization', userAuth)
      .send({ title: 'Need help', description: 'My order failed', category: 'technical', priority: 'medium' });
    expect(res.status).toBe(201);
    expect(res.body.ticket).toBeDefined();
  });

  test('returns 400 for invalid category', async () => {
    const res = await request(app)
      .post('/api/admin/tickets')
      .set('Authorization', userAuth)
      .send({ title: 'Need help', description: 'Desc', category: 'invalid_category' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/tickets/mine', () => {
  test('returns user own tickets', async () => {
    mockDb.manyOrNone.mockResolvedValueOnce([MOCK_TICKET]);
    const res = await request(app).get('/api/admin/tickets/mine').set('Authorization', userAuth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tickets)).toBe(true);
  });
});
