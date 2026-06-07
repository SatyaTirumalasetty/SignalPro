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
psql -U signalpro_user -d signalpro_dev -f ../database/init.sql
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
     -U admin -d signalpro_prod < database/init.sql
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
      - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql

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

