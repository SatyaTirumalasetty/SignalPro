# SignalPro Enterprise - Deployment Guide

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis (optional, for rate limiting)
- Git

### Step 1: Clone & Setup

```bash
cd signalpro-enterprise/backend
npm install
cp .env.example .env
```

### Step 2: Configure Environment

Edit `.env` with your values:

```bash
# Database
DB_HOST=localhost
DB_NAME=signalpro_dev
DB_USER=postgres
DB_PASSWORD=postgres

# JWT (generate secure random strings)
JWT_SECRET=your_64_char_secure_random_string_here!!!
JWT_REFRESH_SECRET=another_64_char_secure_random_string!!!

# Encryption (must be exactly 32 bytes for AES-256)
ENCRYPTION_KEY=dev_key_32_chars_minimum_change_me!!! # exactly 32 chars
ENCRYPTION_IV=0123456789abcdef # exactly 16 chars

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Step 3: Initialize Database

```bash
# Connect to PostgreSQL
psql -U postgres -h localhost

# Create database and user
CREATE DATABASE signalpro_dev;
CREATE USER signalpro_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE signalpro_dev TO signalpro_user;

# Run schema initialization
psql -U signalpro_user -d signalpro_dev -f backend/database/init.sql
```

### Step 4: Start Development Server

```bash
npm run dev
```

Server will start on `http://localhost:3001`

Test with:
```bash
curl http://localhost:3001/api/health
# Should return: {"status":"ok","version":"1.0.0",...}
```

---

## Production (AWS + Vercel)

> This section documents the actual production deployment for `bearbull.app` —
> Vercel (frontend) + AWS ECS Fargate (backend) + RDS + Secrets Manager, wired
> together by a gated GitHub Actions pipeline. It supersedes the generic
> "Production Deployment (AWS)" walkthrough further down this file, which
> predates this build-out and describes a different (ElastiCache/ALB-manual/
> ECR-manual) architecture that was never actually provisioned.

### Architecture summary

```
┌────────────────────┐        ┌─────────────────────────────────────────┐
│  Vercel (frontend)  │  HTTPS │  ALB (ACM cert) → ECS Fargate (1 task)   │
│  bearbull.app       │───────▶│  api.bearbull.app                       │
│  React/Vite SPA     │        │  Express backend + auto-trading cron    │
└────────────────────┘        └──────────────┬──────────────────────────┘
                                              │
                               ┌──────────────▼──────────────┐
                               │  RDS Postgres 16              │
                               │  db.t4g.micro (single-AZ)      │
                               │  7-day automated backups       │
                               └────────────────────────────────┘
                                              │
                               ┌──────────────▼──────────────┐
                               │  Secrets Manager               │
                               │  signalpro/prod/app            │
                               │  (JWT, encryption, Alpaca,      │
                               │   SMTP, DB credentials)         │
                               └────────────────────────────────┘
```

Everything runs against **Alpaca's paper trading API only**. The service
manifest sets `ALPACA_FORCE_PAPER: 'true'` (`copilot/api/manifest.yml`), which
the `AlpacaAdapter` constructor (`backend/src/services/brokers/adapters/alpaca.js`)
enforces by rewriting any non-paper credential set onto the paper endpoint
before it's ever used — so even if a user connects a live-flagged Alpaca key,
orders still route to paper. There is one Fargate task (`cpu: 256`,
`memory: 512`, `count: 1`) in public subnets (avoids the ~$32/mo NAT gateway;
the security group still restricts ingress to the ALB), fronted by an ALB
with an ACM certificate for the `api.bearbull.app` alias. The frontend is a
static Vite build served by Vercel with a SPA rewrite
(`frontend/vercel.json`) so deep links like `/dashboard` resolve correctly.
CORS is controlled by `FRONTEND_URLS` (comma-separated allow-list) and
`CORS_ALLOW_VERCEL_PREVIEWS` (lets `*.vercel.app` preview URLs call the API
for testing without loosening prod CORS).

### One-time operator setup

This is a one-time bootstrap; it does not run on every deploy.

**1. Domain + DNS (Route53).** Register `bearbull.app` with a registrar (or
directly in Route53), then create the hosted zone and delegate DNS:

```bash
aws route53 create-hosted-zone --name bearbull.app --caller-reference "signalpro-$(date +%s)"
aws route53 get-hosted-zone --id <ZONE_ID> --query "DelegationSet.NameServers"
# set the 4 returned NS values as the domain's nameservers at the registrar
```

**2. App secret (Secrets Manager, region `us-east-1`).** Create
`signalpro/prod/app` with every runtime secret the backend reads at boot
(`config/secrets.js` copies each key into `process.env`):

```bash
aws secretsmanager create-secret --region us-east-1 --name signalpro/prod/app --secret-string '{
  "JWT_SECRET": "<64-char-random>",
  "JWT_REFRESH_SECRET": "<64-char-random>",
  "ENCRYPTION_KEY": "<exactly-32-chars>",
  "ENCRYPTION_IV": "<exactly-16-chars>",
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "ALPACA_API_KEY": "<alpaca PAPER key id>",
  "ALPACA_API_SECRET": "<alpaca PAPER secret>",
  "ALPACA_DATA_FEED": "iex",
  "SMTP_HOST": "<smtp host>",
  "SMTP_PORT": "587",
  "SMTP_USER": "<smtp user>",
  "SMTP_PASSWORD": "<smtp password>",
  "FROM_EMAIL": "alerts@bearbull.app",
  "DB_USER": "signalpro",
  "DB_NAME": "signalpro",
  "DB_PORT": "5432",
  "DB_PASSWORD": "<strong-random-no-quotes-slashes-or-@>"
}'
```

Use **PAPER Alpaca keys only**. `DB_HOST` is added after RDS exists (step 3)
by merging it into the same secret with `put-secret-value`.

**3. Copilot infrastructure (ECS + ALB + RDS).**

```bash
copilot app init signalpro --domain bearbull.app
copilot env init --name prod --profile default --default-config
copilot svc init --name api --svc-type "Load Balanced Web Service" --dockerfile ./Dockerfile
copilot env deploy --name prod        # provisions VPC, ALB, ACM cert, RDS (~15 min)
# fetch the RDS endpoint and merge it into the secret as DB_HOST, then:
copilot svc deploy --name api --env prod
curl -fsS https://api.bearbull.app/api/health
```

The service manifest (`copilot/api/manifest.yml`) and the RDS environment
addon (`copilot/environments/prod/addons/db.yml`) are already committed —
`copilot env/svc deploy` reads them directly; there is nothing to author by
hand here. The task role's access to the secret is granted by
`copilot/api/addons/app-secret-policy.yml` (scoped to
`secretsmanager:GetSecretValue` on `signalpro/prod/app-*` only).

**4. GitHub OIDC deploy role.** Deploy `deployment/github-oidc-role.yml` —
it creates the `signalpro-github-deploy` IAM role that CI assumes via OIDC
(no long-lived AWS keys in GitHub), scoped to `sts:AssumeRoleWithWebIdentity`
from `refs/heads/master` of this repo only:

```bash
aws cloudformation deploy --region us-east-1 --template-file deployment/github-oidc-role.yml \
  --stack-name signalpro-github-oidc --capabilities CAPABILITY_NAMED_IAM
gh secret set AWS_DEPLOY_ROLE_ARN --repo SatyaTirumalasetty/SignalPro \
  --body "<DeployRoleArn from the stack output>"
```

**5. Vercel project.** In the Vercel dashboard: **Add New Project** → import
the repo → set **Root Directory** to `frontend` → set
`VITE_API_BASE_URL=https://api.bearbull.app` for **both Production and
Preview** environments → add domains `bearbull.app` and `www.bearbull.app`
(the required A/CNAME records go into the Route53 hosted zone from step 1).
`frontend/vercel.json` already disables Git-triggered production deploys
(`git.deploymentEnabled.master: false`) — production only ships via the CI
`vercel deploy --prebuilt --prod` step, never a raw push. Then link locally
to capture the org/project IDs for CI:

```bash
cd frontend && npx vercel link
cat .vercel/project.json   # orgId, projectId
gh secret set VERCEL_ORG_ID --repo SatyaTirumalasetty/SignalPro --body "<orgId>"
gh secret set VERCEL_PROJECT_ID --repo SatyaTirumalasetty/SignalPro --body "<projectId>"
gh secret set VERCEL_TOKEN --repo SatyaTirumalasetty/SignalPro --body "<token from vercel.com/account/tokens>"
```

### How a deploy happens

Every push to `master` runs the full CI pipeline defined in
`.github/workflows/ci.yml`. The `deploy` job only runs when the push lands on
`master` (not on PRs) and only after four jobs succeed:

- `test` — backend Jest + frontend Vitest suites, lint, frontend build
- `docker-build` — builds both backend and frontend images (build-only, no push)
- `sonarqube` — SonarQube quality gate; **hard-fails** the build on a red gate
- `dependency-scan` — Trivy scan of both `package-lock.json` trees; **hard-fails** on any fixable CRITICAL/HIGH vulnerability

If all four pass, `deploy` runs in order:

1. Assume `signalpro-github-deploy` via OIDC (`aws-actions/configure-aws-credentials`, `us-east-1`)
2. `copilot deploy --app signalpro --name api --env prod` — builds the backend image, pushes to ECR, rolls ECS forward
3. Smoke test: `curl https://api.bearbull.app/api/health` (retried up to 10× / 15s apart to ride out rollout)
4. Only if the smoke test passes: `vercel pull` / `vercel build --prod` / `vercel deploy --prebuilt --prod` against the linked Vercel project

That ordering is the safety gate — a failed backend deploy or a failed
health check stops the job before the frontend step runs, so `bearbull.app`
is never pointed at a dead API. The job has `concurrency: production-deploy`
with `cancel-in-progress: false`, so overlapping pushes to `master` queue
rather than racing each other.

### Watching a deploy

```bash
gh run watch --exit-status                              # follow the current CI run to completion
copilot svc logs --name api --env prod --follow          # tail backend logs (startup banner, migrations, cron heartbeat)
copilot svc status --name api --env prod                 # task health, running count, deployment status
```

### Rollback

**Automatic:** the service manifest's health check
(`copilot/api/manifest.yml`, path `/api/health`, `grace_period: 180s` to allow
migrations to run before the first check) is backed by ECS's deployment
circuit breaker. If the new task definition never passes its health check —
for example a migration throws in `backend/src/database/migrate.js`, which
calls `process.exit(1)` before `server.listen()` ever runs — ECS detects the
failed rollout and automatically rolls back to the last healthy task
definition. No manual action needed; nothing to do but read the logs.

**Manual:** to force a specific known-good version back onto production,
check out that commit and redeploy from it:

```bash
git checkout <last-good-sha>
copilot deploy --app signalpro --name api --env prod
```

(or re-run the `deploy` job for that commit's CI run via `gh run rerun`). The
frontend equivalent is re-running the Vercel deploy step against an older
commit, or promoting a prior Vercel deployment from the dashboard's
Deployments list.

### Secret rotation

Secrets never require a code change or redeploy of new code — only a task
restart to pick up the new values, since `config/secrets.js` loads them once
at process boot:

```bash
aws secretsmanager get-secret-value --region us-east-1 --secret-id signalpro/prod/app \
  --query SecretString --output text > /tmp/app-secret.json
# edit /tmp/app-secret.json with the rotated value(s)
aws secretsmanager put-secret-value --region us-east-1 --secret-id signalpro/prod/app \
  --secret-string file:///tmp/app-secret.json
rm /tmp/app-secret.json
copilot svc deploy --name api --env prod   # restarts the task so it re-reads the secret
```

### Monthly cost

| Item | Approx. cost |
| --- | --- |
| Fargate (1 task, 0.25 vCPU / 512 MB) | ~$9/mo |
| Application Load Balancer | ~$16/mo |
| RDS `db.t4g.micro` Postgres (single-AZ, 20GB gp3) | ~$15/mo |
| Route53 hosted zone + ECR + Secrets Manager + CloudWatch logs | ~$5/mo |
| **AWS total** | **≈$40–50/mo** |
| Domain registration (`bearbull.app`) | ~$15–20/yr |
| Vercel (frontend hosting) | Free tier |

### First-deploy verification checklist (run once, after the first production deploy)

The steps below have not been run yet — nothing is deployed as of this
writing (the AWS/Vercel one-time operator setup above is still pending).
Once the first production deploy completes, work through this list and
record the results in the deploy PR or commit message:

```text
1. https://bearbull.app loads over HTTPS, no mixed-content warnings (browser devtools console clean)
2. Register/login round-trips (JWT issued; check Network tab hits https://api.bearbull.app)
3. Market page renders live Alpaca quotes
4. Place a paper order end-to-end; it appears in Orders
5. CloudWatch: copilot svc logs show auto-trading engine cron heartbeat
6. Deep-link https://bearbull.app/dashboard directly (SPA rewrite works)
7. aws rds describe-db-instances shows BackupRetentionPeriod: 7
8. Alpaca dashboard shows the order under the PAPER account
```

---

## Production Deployment (AWS)

### Architecture Overview

```
┌─────────────────┐
│   CloudFront    │ (CDN for static assets)
│    (CDN)        │
└────────┬────────┘
         │
┌────────▼──────────────┐
│  Application Load     │
│  Balancer (ALB)       │
│  with SSL/TLS         │
└────────┬──────────────┘
         │
┌────────▼──────────────────────┐
│   ECS Cluster (Auto Scaling)   │
│  ┌─────────┐  ┌─────────┐     │
│  │Container│  │Container│ ... │
│  │  Port   │  │  Port   │     │
│  │  3001   │  │  3001   │     │
│  └─────────┘  └─────────┘     │
└────────┬──────────────────────┘
         │
    ┌────┼────┐
    │    │    │
┌───▼──┐ │ ┌─▼────┐
│RDS   │ │ │Redis │
│PG    │ │ │Cache │
└──────┘ │ └──────┘
         │
    ┌────▼────┐
    │  S3     │
    │ Bucket  │
    └─────────┘
```

### AWS Infrastructure Setup

#### 1. RDS PostgreSQL Instance

```bash
# Create PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier signalpro-prod \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 14.7 \
  --allocated-storage 100 \
  --db-name signalpro_prod \
  --master-username admin \
  --master-user-password "YourSecurePassword123!" \
  --backup-retention-period 30 \
  --multi-az \
  --storage-encrypted \
  --publicly-accessible false
```

After RDS is ready, initialize database:

```bash
# Get RDS endpoint
aws rds describe-db-instances --query 'DBInstances[0].Endpoint.Address'

# Connect and run schema
psql -h signalpro-prod.xxxxx.ap-southeast-1.rds.amazonaws.com \
     -U admin -d signalpro_prod < backend/database/init.sql
```

#### 2. ElastiCache Redis

```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id signalpro-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --num-cache-nodes 1 \
  --auto-minor-version-upgrade
```

#### 3. S3 Bucket for Backups & Documents

```bash
aws s3 mb s3://signalpro-prod-backups --region ap-southeast-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket signalpro-prod-backups \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket signalpro-prod-backups \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
  }'
```

#### 4. Application Load Balancer

```bash
# Create ALB
aws elbv2 create-load-balancer \
  --name signalpro-alb \
  --subnets subnet-12345678 subnet-87654321 \
  --security-groups sg-12345678 \
  --scheme internet-facing

# Create target group
aws elbv2 create-target-group \
  --name signalpro-tg \
  --protocol HTTP \
  --port 3001 \
  --vpc-id vpc-12345678 \
  --health-check-path /api/health
```

#### 5. ECS Cluster & Task Definition

```bash
# Create cluster
aws ecs create-cluster --cluster-name signalpro-prod

# Create task definition (use Dockerfile below)
aws ecs register-task-definition --cli-input-json file://task-definition.json

# Create service
aws ecs create-service \
  --cluster signalpro-prod \
  --service-name signalpro-api \
  --task-definition signalpro:1 \
  --desired-count 3 \
  --launch-type EC2
```

---

### Docker Containerization

#### Dockerfile for Backend

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY backend/src ./src
COPY backend/src/config ./config

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "src/server.js"]
```

#### docker-compose.yml (Local Development)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: signalpro_dev
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/database/init.sql:/docker-entrypoint-initdb.d/init.sql

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    environment:
      NODE_ENV: development
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: signalpro_dev
      DB_USER: postgres
      DB_PASSWORD: postgres
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-secret-64-chars-minimum-change-me-immediately!
      ENCRYPTION_KEY: dev_key_32_chars_minimum_change_me!!!
      ENCRYPTION_IV: 0123456789abcdef
    ports:
      - "3001:3001"
    depends_on:
      - postgres
      - redis
    command: npm run dev

volumes:
  postgres_data:
```

Start with:
```bash
docker-compose up
```

---

### GitHub Actions CI/CD Pipeline

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  AWS_REGION: ap-southeast-1
  ECR_REPOSITORY: signalpro

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - run: cd backend && npm install
      - run: cd backend && npm run lint
      - run: cd backend && npm test

  build:
    needs: test
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest

    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v3
      - uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/github-actions
          aws-region: ap-southeast-1

      - uses: aws-actions/amazon-ecr-login@v1
        id: login-ecr

      - name: Build Docker image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -f backend/Dockerfile -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

      - name: Update ECS service
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          aws ecs update-service \
            --cluster signalpro-prod \
            --service signalpro-api \
            --force-new-deployment
```

---

### Environment Variables for Production

Create AWS Secrets Manager secret:

```bash
aws secretsmanager create-secret \
  --name signalpro/prod/env \
  --secret-string '{
    "DB_HOST": "signalpro-prod.xxxxx.rds.amazonaws.com",
    "DB_NAME": "signalpro_prod",
    "DB_USER": "admin",
    "DB_PASSWORD": "ReallySecurePassword123!",
    "REDIS_URL": "redis://signalpro-redis.xxxxx.ng.0001.aps1.cache.amazonaws.com:6379",
    "JWT_SECRET": "GeneratedSecureJWTSecret64CharsMinimumHere!",
    "ENCRYPTION_KEY": "GeneratedSecureEncryptionKey32Chars",
    "ENCRYPTION_IV": "GeneratedSecureIV16CharsHere!",
    "ANTHROPIC_API_KEY": "sk-ant-your-key",
    "STRIPE_SECRET_KEY": "sk_live_...",
    "SENDGRID_API_KEY": "SG.xxxx"
  }'
```

Retrieve in application:

```javascript
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

async function getSecrets() {
  const secret = await secretsManager.getSecretValue({ SecretId: 'signalpro/prod/env' }).promise();
  return JSON.parse(secret.SecretString);
}
```

---

### Monitoring & Logging

#### CloudWatch Logs

```javascript
// In src/config/logger.js
const CloudWatchTransport = require('pino-cloudwatch');

const pinoCloudWatch = new CloudWatchTransport({
  logGroupName: '/aws/ecs/signalpro-prod',
  logStreamName: 'backend',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsRegion: process.env.AWS_REGION,
});
```

#### Sentry Error Tracking

```bash
npm install @sentry/node
```

```javascript
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});

app.use(Sentry.Handlers.requestHandler());
// ... routes ...
app.use(Sentry.Handlers.errorHandler());
```

---

### Database Backups

#### Automated RDS Backup

Already enabled when you create RDS instance. For additional backup:

```bash
# Manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier signalpro-prod \
  --db-snapshot-identifier signalpro-backup-$(date +%Y-%m-%d)
```

#### Point-in-Time Recovery

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier signalpro-prod-restore \
  --db-snapshot-identifier signalpro-backup-2024-01-15
```

---

### SSL/TLS Certificate

Using AWS Certificate Manager:

```bash
aws acm request-certificate \
  --domain-name signalpro.com \
  --domain-name app.signalpro.com \
  --validation-method DNS
```

Attach to ALB listener:

```bash
aws elbv2 modify-listener \
  --listener-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:...
```

---

### Static Analysis & Dependency Scanning (SonarQube + Black Duck)

The CI pipeline (`.github/workflows/ci.yml`) includes gated `sonarqube` and
`blackduck` jobs that only run real scans once the following repo secrets are
configured (Settings → Secrets and variables → Actions):

| Secret | Purpose |
| --- | --- |
| `SONAR_TOKEN` | Auth token for your SonarQube/SonarCloud instance |
| `SONAR_HOST_URL` | Base URL of your SonarQube server (omit for SonarCloud) |
| `BLACKDUCK_URL` | Base URL of your Black Duck Hub |
| `BLACKDUCK_API_TOKEN` | Black Duck API token with scan permissions |

Project-level Sonar settings live in `sonar-project.properties` at the repo
root (sources, exclusions, lcov coverage import paths). Given this is a
financial trading platform, both jobs are configured to **hard-fail the
build** — the SonarQube quality gate has no soft-fail, and Black Duck is set
to block on `BLOCKER`/`CRITICAL`/`HIGH` severity findings
(`blackducksca_scan_failure_severities`). Treat any red result from either
scan as a release blocker, not a warning to triage later — verify the
Black Duck action name/version against your tenant's current docs before
relying on it, since Synopsys has rebranded this tooling more than once.

### Security Checklist

- [ ] All environment variables in AWS Secrets Manager
- [ ] RDS encryption enabled at rest
- [ ] RDS automated backups enabled (30+ days)
- [ ] VPC security groups restrict access
- [ ] ALB with SSL/TLS certificate
- [ ] API keys rotated quarterly
- [ ] Database credentials rotated every 90 days
- [ ] Sentry error tracking enabled
- [ ] CloudWatch alarms for high error rates
- [ ] DDoS protection (AWS Shield)
- [ ] WAF rules enabled (AWS WAF)

---

### Scaling Checklist

**Week 1-4 (1K users):**
- Single RDS instance (db.t3.small)
- 2-3 ECS tasks
- Redis cache for rate limiting

**Month 2-3 (5K users):**
- RDS read replica
- Auto-scaling ECS (min 3, max 10)
- Implement caching layer (Redis)
- Database connection pooling

**Month 6+ (25K+ users):**
- Database partitioning
- Message queue (RabbitMQ/SQS)
- Microservices (separate API, AI worker, trading engine)
- Multi-region deployment

