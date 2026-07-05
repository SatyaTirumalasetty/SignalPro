# SignalPro Production Deployment & CI/CD — Design

**Date:** 2026-07-06
**Status:** Approved
**Sub-project:** 1 of 4 (deployment → observability dashboard → engine deepening → UI modernization)

## Goal

Ship SignalPro to production with an automated, test-gated pipeline: the React
frontend on Vercel, the Express backend (including the 24/7 auto-trading
engine) on AWS, and a single push to `master` carrying code all the way to
production when — and only when — the full test suite is green.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Frontend hosting | Vercel | Static Vite build; free PR preview deployments |
| Backend hosting | AWS ECS Fargate (1 task) | Trading engine needs a 24/7 process; Vercel serverless cannot host it |
| Database | RDS Postgres, `db.t4g.micro` | ~$15/mo vs ~$45/mo for Aurora Serverless v2; automated backups |
| Redis | Skipped | Backend degrades gracefully to in-memory rate limiting; fine for one task |
| Infra as code | AWS Copilot CLI | Generates ECS/ALB/VPC/secrets wiring from small manifests; least code to own |
| CI engine | GitHub Actions | Repo already on GitHub |
| Pipeline shape | Direct `master` → prod, gated by tests | Solo project; PRs get Vercel previews |
| AWS auth from CI | GitHub OIDC federated IAM role | No long-lived AWS keys in GitHub secrets |
| API HTTPS | CloudFront in front of the ALB (default `*.cloudfront.net` cert) | No custom domain owned; avoids mixed-content blocking from the HTTPS Vercel site; a custom domain can be added later without rework |
| Trading mode | Alpaca **paper API only**, enforced by env config | Engine proves itself before real money; live trading is a later, deliberate step |

## Architecture

```
GitHub (master) ──► GitHub Actions ──► ECR ──► ECS Fargate service "api"
                         │                       (Express + trading engine)
                         └──► Vercel (React SPA)      │
                                   │                  ├─► RDS Postgres (db.t4g.micro)
                                   └── HTTPS ──► CloudFront ──► ALB ──► task
                                                      ├─► AWS Secrets Manager
                                                      └─► CloudWatch Logs
```

- Single Fargate task, 0.25 vCPU / 512 MB (engine is I/O-bound). Always on.
- ALB health-checks `GET /api/health` (endpoint already exists).
- The browser talks to the API via the CloudFront HTTPS URL; `VITE_API_BASE_URL`
  is set to it at frontend build time. Backend CORS allowlist gains the Vercel
  production domain and preview-domain pattern.

## Components

### `copilot/` directory (checked into repo)

- App `signalpro`, environment `prod`, service `api` (Load Balanced Web
  Service manifest pointing at the existing root `Dockerfile`).
- **RDS addon:** a CloudFormation template under
  `copilot/api/addons/` provisioning a `db.t4g.micro` Postgres instance in the
  environment VPC, with connection details injected into the task as the
  discrete `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` vars
  the backend's config loader reads (`backend/src/config/database.js`; the
  `DATABASE_URL` in docker-compose is unused by the app).
  Automated daily backups enabled (7-day retention).
- **Secrets:** JWT secrets, encryption key/IV, `ANTHROPIC_API_KEY`, Alpaca
  paper keys, SMTP credentials — stored in AWS Secrets Manager, referenced
  from the service manifest. The backend's existing Secrets Manager loader
  keeps working unchanged.
- **CloudFront:** enabled via the environment manifest (`cdn: true`) so the
  API is reachable over HTTPS at the distribution's default domain.
- ECS deployment circuit breaker on: a deploy whose tasks fail health checks
  auto-rolls back to the previous revision.

### Database initialization & migrations

- Fresh production database initialized from `database/init.sql` (one-time,
  during environment setup).
- `npm run migrate` runs at container startup, before the server listens.
  With a single task there is no migration race. If a migration fails, the
  task exits, the health check never passes, and the circuit breaker rolls
  back.

### GitHub Actions workflows

**`ci.yml` — on pull request and push to master:**
1. Backend: ESLint + Jest (with coverage).
2. Frontend: ESLint + Vitest + `tsc -b` + Vite build.
3. Docker image builds successfully (PRs only build; no push).

Vercel's Git integration builds a preview URL per PR independently.

**`deploy.yml` — on push to master, after `ci.yml` gates pass:**
1. Assume the OIDC IAM role.
2. Build the backend image, push to ECR.
3. `copilot deploy --name api --env prod`.
4. Smoke test: `GET <api-url>/api/health` must return 200.
5. Build the frontend with the production `VITE_API_BASE_URL` and deploy via
   `vercel deploy --prebuilt --prod`.

Vercel's automatic production deploys on `master` are disabled (previews stay
enabled), so a red test suite blocks the frontend too — the gate is real.
Ordering guarantees the live site never points at a dead API: if the backend
deploy or smoke test fails, the frontend step never runs.

## Error handling

- **Backend deploy failure** → ECS circuit breaker rolls back; workflow fails
  loudly; previous version keeps serving.
- **Smoke test failure** → frontend deploy skipped; workflow fails.
- **Migration failure** → task exits before listening; rollback as above.
- **Runtime** → existing engine circuit breaker + email alerts unchanged;
  all pino logs land in CloudWatch Logs via the awslogs driver (Copilot
  default).

## Testing & verification

- Pipeline gates: full backend Jest + frontend Vitest suites (already
  substantial) on every PR and push.
- Post-deploy smoke test of `/api/health`.
- Manual first-deploy verification checklist: login flow works from the
  Vercel URL, live quotes render, auto-trading engine heartbeat visible in
  CloudWatch logs, an order round-trips against Alpaca paper.

## Cost estimate

~$40–50/month: Fargate ~$9, ALB ~$16, RDS ~$15, CloudFront/ECR/Secrets/logs
~$5. Vercel free tier.

## Out of scope (later sub-projects)

- Observability dashboard for the trading engine (sub-project 2).
- Strategy configuration / engine deepening (sub-project 3).
- UI modernization (sub-project 4).
- Staging environment, live trading, multi-region, ElastiCache, custom domain
  (each can be layered on later without rework).
