# SignalPro Enterprise - Quick Start (10 Minutes)

## Fastest Path to Running

### 1. Prerequisites (Already Installed?)
```bash
node --version  # Should be 18+
npm --version
docker --version
docker-compose --version
```

If not, install:
- Node.js: https://nodejs.org/
- Docker Desktop: https://www.docker.com/products/docker-desktop

### 2. Clone & Navigate
```bash
git clone <your-repo>
cd signalpro-enterprise
```

### 3. One Command: Start Everything

**Option A: With Docker (Recommended)**
```bash
docker-compose up
```

Done! You now have:
- Backend: http://localhost:3001
- PostgreSQL: localhost:5432
- Redis: localhost:6379

Test it:
```bash
curl http://localhost:3001/api/health
```

**Option B: Manual Setup**

```bash
# Terminal 1: PostgreSQL
docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -v postgres_data:/var/lib/postgresql/data postgres:14-alpine
psql -h localhost -U postgres < backend/database/init.sql

# Terminal 2: Redis
docker run --name redis -p 6379:6379 redis:7-alpine

# Terminal 3: Node Backend
cd backend
npm install
cp .env.example .env
npm run dev
```

### 4. Test API Endpoints

```bash
# Register
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePassword123!",
    "full_name": "Test User"
  }'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePassword123!"
  }'

# Use returned token in future requests
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  http://localhost:3001/api/users/me
```

### 5. Access Database (Optional)

```bash
# Connect to PostgreSQL
psql -h localhost -U postgres -d signalpro_dev

# Check schema
\dt  # Show tables
\d users  # Describe users table

# Run queries
SELECT COUNT(*) FROM users;
```

---

## What's Running?

| Service | Port | Status |
|---------|------|--------|
| Backend API | 3001 | ✅ Running |
| PostgreSQL | 5432 | ✅ Running |
| Redis | 6379 | ✅ Running |

---

## Project Structure

```
signalpro-enterprise/
├── backend/                  # Node.js/Express API
│   ├── src/
│   │   ├── server.js        # Main entry point
│   │   ├── config/          # DB, encryption, logging
│   │   ├── middleware/      # Auth, rate limiting, errors
│   │   ├── routes/          # API endpoints
│   │   ├── services/        # Business logic (phase 2+)
│   │   └── utils/           # Helpers
│   ├── Dockerfile           # Containerization
│   └── package.json
├── frontend/                 # React app (phase 6)
├── admin/                    # Admin dashboard (phase 5)
├── backend/database/
│   └── init.sql             # PostgreSQL schema
├── ROADMAP.md               # Phase-by-phase plan
├── DEPLOYMENT_GUIDE.md      # Production AWS setup
└── DATABASE_SCHEMA.md       # Data model docs
```

---

## Development Workflow

### Local Development Loop

```bash
# Make changes in backend/src/routes/*.js
# Server auto-reloads with nodemon
# Test with curl or Postman

# Run tests
npm test

# Check linting
npm run lint

# Format code
npm run format
```

### Adding New Routes

1. Create file: `backend/src/routes/myroute.js`
2. Import in `server.js`: `app.use('/api/myroute', myRoutes)`
3. Test: `curl http://localhost:3001/api/myroute`

### Adding Database Changes

1. Create migration in `backend/database/migrations/`
2. Run: `npm run migrate`
3. Update schema docs

---

## Troubleshooting

**Port Already in Use?**
```bash
# Kill process on port 3001
lsof -i :3001
kill -9 <PID>
```

**Database Connection Error?**
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Check credentials in .env
cat backend/.env | grep DB_
```

**Redis Connection Fails?**
```bash
# Falls back to memory store automatically
# But if you want to fix it:
docker run --name redis -p 6379:6379 redis:7-alpine
```

**Node Modules Issue?**
```bash
rm -rf backend/node_modules package-lock.json
cd backend && npm install
```

---

## What's Next?

### Phase 1 Status: ✅ **IN PROGRESS**
- [x] Database schema created
- [x] Auth system (register/login/logout)
- [x] JWT tokens
- [x] Rate limiting middleware
- [x] Audit logging
- [ ] Email verification
- [ ] 2FA setup

### Phase 2 (Next):
- Broker integration (Zerodha, HDFC, Moomoo)
- Encrypted credential storage
- Broker connection management

### Follow the Roadmap:
Read `ROADMAP.md` for complete 12-week plan with timelines for each phase.

---

## Important Files to Understand

1. **Database Schema**: `DATABASE_SCHEMA.md`
   - Understand all tables and relationships
   - Read before modifying schema

2. **Implementation Plan**: `ROADMAP.md`
   - Phases 1-6 with weekly breakdown
   - Deliverables and API endpoints for each phase

3. **Deployment**: `DEPLOYMENT_GUIDE.md`
   - Local Docker setup (quick)
   - Production AWS deployment (complete)

4. **Configuration**: `backend/.env.example`
   - All configurable options
   - Security best practices

---

## Commit to GitHub

```bash
git add .
git commit -m "Phase 1: Core auth and database setup"
git push origin main
```

This triggers CI/CD pipeline (GitHub Actions) defined in `.github/workflows/deploy.yml`.

---

## Environment Variables

**For Development**: Copy `.env.example` to `.env` and modify.

**For Production**: Use AWS Secrets Manager.

**Critical Variables** (Change these!):
```
JWT_SECRET=your_64_char_secret_here
ENCRYPTION_KEY=your_32_char_key_here
ENCRYPTION_IV=your_16_char_iv_here
DB_PASSWORD=your_secure_db_password
```

Generate secure random values:
```bash
# Linux/Mac
openssl rand -base64 32  # For 32-byte key
openssl rand -hex 16     # For 16-byte IV
```

---

## Testing the API

### With curl (command line):
```bash
curl -X GET http://localhost:3001/api/health
```

### With Postman (GUI):
1. Download: https://www.postman.com/downloads/
2. Import: `backend/postman_collection.json` (create after routes are done)
3. Set variable: `{{BASE_URL}}` = `http://localhost:3001`

### With REST Client (VSCode):
Install extension: `REST Client`
Create `test.http`:
```http
@base = http://localhost:3001

### Health check
GET {{base}}/api/health

### Register
POST {{base}}/api/auth/register
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "Test123!@",
  "full_name": "John Doe"
}
```

---

## Database Administration

### Connect via CLI:
```bash
psql -h localhost -U postgres -d signalpro_dev
```

### Useful commands:
```sql
-- List all tables
\dt

-- Describe table
\d users

-- Count users
SELECT COUNT(*) FROM users;

-- View audit logs
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10;

-- Check subscriptions
SELECT u.email, s.status, p.name FROM subscriptions s
JOIN users u ON s.user_id = u.id
JOIN pricing_plans p ON s.plan_id = p.id;
```

### Reset database (development only!):
```bash
# Drop and recreate
psql -h localhost -U postgres -d signalpro_dev
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
-- ... drop all tables ...
psql -h localhost -U postgres -d signalpro_dev < backend/database/init.sql
```

---

## Performance Tips

- Add indexes for frequently queried columns (done in schema)
- Use connection pooling (pg-promise handles this)
- Cache price data in Redis
- Use database views for complex reports
- Monitor slow queries: `log_min_duration_statement = 1000` in PostgreSQL

---

## Security Reminders

✅ **Before Production:**
- [ ] Change all default passwords
- [ ] Rotate JWT secrets
- [ ] Enable HTTPS (AWS ACM)
- [ ] Set up firewall rules
- [ ] Enable database encryption
- [ ] Regular security audits
- [ ] Set up monitoring & alerts
- [ ] GDPR/data protection compliance

---

## Getting Help

1. **Docs**: Read `ROADMAP.md` and `DATABASE_SCHEMA.md`
2. **Errors**: Check logs in `docker-compose logs -f`
3. **Stack**: Ask in code comments or create GitHub issues

---

**Ready? Start with Phase 1 by implementing:**
1. Email verification (auth.js)
2. 2FA setup (totp)
3. User profile management

Then move to Phase 2 (broker integrations).

Happy coding! 🚀
