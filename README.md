# Multi-Tenant LLM Usage Metering & Billing Engine

A correctness-focused Fastify backend that meters API and AI-token usage, enforces tenant plan quotas, calculates deterministic integer costs, and synchronizes Stripe test-mode subscriptions safely.

Status: Phase 9 complete. Core API behavior is implemented and covered by automated tests. Real Stripe CLI evidence remains a manual test-mode step because credentials are never stored in the repository.

## What the system proves

- Tenant-scoped usage and plan state
- Retry-safe billable requests with exact response replay
- Atomic usage, quota, cost, and idempotency writes
- Exact inclusive quota boundaries
- Integer micro-cent pricing with category-specific rates
- Current UTC-month usage and cost rollups
- Stripe test-mode Checkout customer creation/reuse
- Raw-body webhook signature verification
- Duplicate Stripe event protection
- Transactional plan and subscription projection

## Tech stack

Node.js 20+, Fastify, TypeScript, PostgreSQL 16, Prisma, Stripe SDK, Zod, Vitest, dotenv, and Docker Compose.

## Architecture

    HTTP request
        |
    Fastify route
        |
    Domain service
        |
    Repository / Prisma transaction
        |
    PostgreSQL

    Checkout request -> Stripe test-mode gateway
    Stripe webhook -> raw Buffer -> signature verification
                   -> unique event claim -> subscription projection

Routes handle HTTP concerns. Services own idempotency, quota, pricing, billing, and webhook rules. Repository helpers own database queries. Configuration pins pricing and validates Stripe inputs. See ARCHITECTURE.md for detailed flows.

## Setup

Requirements: Node.js 20+, npm, Docker Desktop, and optionally Stripe CLI.

    npm install
    Copy-Item .env.example .env
    docker compose up -d postgres
    npm run db:generate
    npm run db:migrate
    npm run db:seed
    npm run dev

The seed is idempotent. It creates Free and Pro plans plus:

| Tenant ID | Plan | Seed usage |
| --- | --- | --- |
| tenant_demo_free | Free | none |
| tenant_demo_pro | Pro | none |
| tenant_near_quota_free | Free | 999 API calls and 50,000 AI tokens in the current UTC month |

Plan limits:

| Plan | API calls/month | AI tokens/month |
| --- | ---: | ---: |
| Free | 1,000 | 100,000 |
| Pro | 50,000 | 5,000,000 |

## Environment variables

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection string |
| PORT | HTTP port; defaults to 3000 |
| STRIPE_SECRET_KEY | Stripe test secret key beginning sk_test_ |
| STRIPE_WEBHOOK_SECRET | Stripe CLI/test signing secret beginning whsec_ |
| STRIPE_PRO_PRICE_ID | Recurring Pro test price ID |
| APP_BASE_URL | Checkout success/cancel origin |

Use placeholders from .env.example. Never use live credentials or commit .env.

## Commands

| Command | Purpose |
| --- | --- |
| npm run dev | Start Fastify in watch mode |
| npm run build | Compile TypeScript |
| npm start | Run compiled output |
| npm run typecheck | Type-check without emitting |
| npm test | Run all tests |
| npm run test:coverage | Run tests with V8 coverage |
| npm run db:generate | Generate Prisma Client |
| npm run db:migrate | Apply/create local migrations |
| npm run db:seed | Idempotently seed plans and demo tenants |
| npm run db:studio | Open Prisma Studio |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health | Liveness |
| POST | /generate | Simulated billable generation |
| GET | /usage | Current tenant usage/cost summary |
| POST | /billing/checkout | Create Pro test-mode Checkout |
| POST | /webhooks/stripe | Verify and process Stripe events |

The seed interface is the CLI command npm run db:seed; there is no HTTP seed endpoint.

### Health

    curl http://localhost:3000/health

Expected response:

    {"status":"ok"}

### Generate and idempotent retry

    curl -X POST http://localhost:3000/generate \
      -H "content-type: application/json" \
      -H "x-tenant-id: tenant_demo_free" \
      -H "idempotency-key: demo-key-1" \
      -d "{\"inputTokens\":1000,\"cachedInputTokens\":200,\"outputTokens\":500,\"reasoningTokens\":100}"

Run the same command again. The response is replayed exactly and usage remains one API call plus 1,800 tokens.

### Usage summary

    curl http://localhost:3000/usage \
      -H "x-tenant-id: tenant_demo_free"

The response includes tenant identity, plan/status, UTC period boundaries, used/limit/remaining quantities, per-type costs, and total micro-cents.

### Quota boundary demo

The near-quota tenant starts at 999 API calls. Use a unique first key to reach exactly 1,000, then a second key to receive 429:

    curl -X POST http://localhost:3000/generate \
      -H "content-type: application/json" \
      -H "x-tenant-id: tenant_near_quota_free" \
      -H "idempotency-key: quota-final-slot" \
      -d "{\"inputTokens\":1,\"cachedInputTokens\":0,\"outputTokens\":0,\"reasoningTokens\":0}"

    curl -X POST http://localhost:3000/generate \
      -H "content-type: application/json" \
      -H "x-tenant-id: tenant_near_quota_free" \
      -H "idempotency-key: quota-over-limit" \
      -d "{\"inputTokens\":1,\"cachedInputTokens\":0,\"outputTokens\":0,\"reasoningTokens\":0}"

Exactly reaching a limit succeeds; projected usage above a limit fails without usage or idempotency writes.

## Pricing

All internal money is integer micro-cents.

| Category | Rate |
| --- | ---: |
| API call | 10 micro-cents/call |
| Input tokens | 100,000 micro-cents/million |
| Cached input tokens | 25,000 micro-cents/million |
| Output tokens | 500,000 micro-cents/million |
| Reasoning tokens | output rate |

Each token category is priced separately with integer ceiling division, so nonzero fractional category cost never rounds to zero. The 1,000/200/500/100 example costs 405 token micro-cents plus 10 for the call: 415 total.

## Stripe test mode

Create one recurring Pro price in Stripe test mode. Configure its price ID and a test secret key, then call:

    curl -X POST http://localhost:3000/billing/checkout \
      -H "x-tenant-id: tenant_demo_free"

Checkout may persist a Stripe customer ID, but never grants Pro access. Only a verified webhook changes plan/status.

For local webhook forwarding:

    stripe listen --forward-to localhost:3000/webhooks/stripe

Copy the displayed signing secret into local STRIPE_WEBHOOK_SECRET. Supported events are checkout.session.completed, customer.subscription.updated, and customer.subscription.deleted. See MANUAL_TESTING.md for the complete demo and replay/forgery checks.

## Security notes

- Only Stripe test secret keys are accepted.
- Webhook verification uses the exact raw request bytes.
- Invalid signatures produce no StripeEvent or tenant mutation.
- Stripe event IDs and tenant/idempotency-key pairs are unique.
- Stripe failures are returned as sanitized errors.
- Tenant-owned reads and writes include tenant identity.
- .env, node_modules, dist, coverage, logs, and local databases are ignored.
- No credential-shaped Stripe key is committed.

The x-tenant-id header models tenant context for this capstone; it is not production authentication. A production service must derive tenant identity from authenticated authorization claims.

## Demo flow

1. Seed plans and demo tenants.
2. Verify /health.
3. Generate usage and replay the same idempotency key.
4. Show /usage did not double-count.
5. Reach the near-quota tenant limit and show 429.
6. Create a Stripe test Checkout Session.
7. Complete Checkout and observe the verified webhook upgrade.
8. Send an invalid signature and show 400 with no state change.
9. Replay a verified event and show duplicate acknowledgement.
10. Finish with /usage showing the active plan, limits, usage, and cost.

## Limitations

No frontend, real AI calls, live payments, invoices, proration, overages, email, billing portal, background reconciliation, admin UI, multi-product catalog, or production deployment configuration.

## Documentation

- API_SPEC.md
- ARCHITECTURE.md
- DATABASE_SCHEMA.md
- PROJECT_PLAN.md
- PHASES.md
- TEST_PLAN.md
- EVIDENCE.md
- BUILDLOG.md
- MANUAL_TESTING.md
