# Multi-Tenant LLM Usage Metering & Billing Engine

A small, correctness-focused backend for metering API and AI-token usage, enforcing monthly quotas, calculating integer-based costs, and synchronizing Stripe test-mode subscriptions safely.

> Status: Phase 2.5 foundation. The database schema and seed data are implemented; GET /health is the only HTTP endpoint implemented. Domain behavior described below is the planned contract.

## What the system does

- Isolates usage and subscription state by tenant.
- Meters one API call and categorized AI tokens for each successful simulated generation.
- prevents retry double-counting through tenant-scoped idempotency.
- Enforces Free and Pro monthly limits at exact boundaries.
- Calculates deterministic costs without floating-point money.
- Upgrades tenants through Stripe Checkout in test mode.
- Verifies webhook signatures and processes each Stripe event once.

## Core features

- `POST /generate` dummy billable operation
- `GET /usage` monthly usage, limits, cost, and period rollup
- Free and Pro plans; API-call and AI-token usage types
- PostgreSQL persistence through Prisma
- Stripe test-mode Checkout and subscription webhooks
- Zod input validation and deterministic Vitest coverage

## Tech stack

Node.js 20+, Fastify, TypeScript, PostgreSQL 16, Prisma, Stripe SDK, Zod, Vitest, dotenv, and Docker Compose.

## Architecture

```text
HTTP request
    |
Fastify route/controller  -- HTTP parsing and response mapping
    |
Domain service            -- idempotency, quota, pricing, billing rules
    |
Repository                -- tenant-scoped persistence
    |
Prisma -> PostgreSQL

Stripe Checkout <-> Billing service
Stripe webhook -> raw-body verification -> deduplication -> subscription update
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for planned request flows and boundaries.

## Setup

1. Install Node.js 20+ and Docker.
2. Copy `.env.example` to `.env`; keep all values local.
3. Install packages: `npm install`.
4. Start PostgreSQL: `docker compose up -d postgres`.
5. Generate the client: `npm run db:generate`.
6. After Phase 2 models land, run `npm run db:migrate` and `npm run db:seed`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | HTTP port (default `3000`) |
| `STRIPE_SECRET_KEY` | Stripe test secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Local/test webhook signing secret |
| `STRIPE_PRO_PRICE_ID` | Stripe test-mode recurring Pro price ID |
| `APP_BASE_URL` | Checkout success/cancel URL base |

Never use live-mode Stripe credentials or commit `.env`.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the TypeScript server with watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Run the deterministic test suite once |
| `npm run test:coverage` | Run tests with coverage |
| `npm run typecheck` | Type-check without emitting files |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:migrate` | Create/apply a local development migration |
| `npm run db:seed` | Seed plans and demo tenants (Phase 2) |
| `npm run db:studio` | Open Prisma Studio |

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| POST | `/seed` | Local demo data setup |
| POST | `/generate` | Simulated billable generation |
| GET | `/usage` | Current tenant usage rollup |
| POST | `/billing/checkout` | Create Pro Checkout Session |
| POST | `/webhooks/stripe` | Receive verified Stripe events |

Only `/health` exists in Phase 1. See [API_SPEC.md](API_SPEC.md) for the planned JSON contracts.

## Stripe test-mode setup

Create one recurring Pro price in Stripe test mode, place its ID in `STRIPE_PRO_PRICE_ID`, and use only `sk_test_...` credentials. During local development, forward Stripe CLI events to `/webhooks/stripe` and copy the resulting `whsec_...` value to `.env`. Checkout should use Stripe-provided test payment methods; no real payment or live key is required.

## Limitations

This MVP has no frontend, real AI calls, live payments, invoicing, proration, overage billing, email, admin UI, multi-product catalog, or production deployment configuration.

## Planned demo flow

Seed tenants; submit billable calls through the quota boundary; replay an idempotent request and prove no double count; show quota rejection; create a test Checkout Session; process its verified webhook; reject a forged webhook; replay the real event safely; then show the final `/usage` rollup.

## Project documentation

- [PROJECT_PLAN.md](PROJECT_PLAN.md)
- [PHASES.md](PHASES.md)
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)
- [TEST_PLAN.md](TEST_PLAN.md)
- [EVIDENCE.md](EVIDENCE.md)
- [BUILDLOG.md](BUILDLOG.md)


## Phase 2 seed data

After npm run db:migrate, run npm run db:seed. The command is safe to rerun and creates or updates:

| Stable tenant ID | Plan | Seeded usage |
| --- | --- | --- |
| tenant_demo_free | Free | None |
| tenant_demo_pro | Pro | None |
| tenant_near_quota_free | Free | 999 current-month API calls and 50,000 AI tokens |

Free is limited to 1,000 API calls and 100,000 tokens monthly. Pro is pinned at 50,000 API calls and 5,000,000 tokens monthly. The Pro plan uses STRIPE_PRO_PRICE_ID when supplied, otherwise a safe test placeholder.


### POST /generate example

With the PostgreSQL service running and seed data loaded:

    curl -X POST http://localhost:3000/generate \
      -H "content-type: application/json" \
      -H "x-tenant-id: tenant_demo_free" \
      -H "idempotency-key: demo-key-1" \
      -d "{\"inputTokens\":1000,\"cachedInputTokens\":200,\"outputTokens\":500,\"reasoningTokens\":100}"

The first request records one API call and 1,800 AI tokens. Repeating the same tenant, key, and body returns the stored response without recording usage again. Pricing is intentionally zero until Phase 5, and quotas are intentionally not enforced until Phase 4.

### Quota rejection example

When a Free tenant is already at 100,000 monthly AI tokens, another token request returns HTTP 429:

    {
      "error": "quota_exceeded",
      "message": "AI token quota exceeded for the current month.",
      "quota": {
        "usageType": "AI_TOKENS",
        "used": 100000,
        "requested": 1,
        "limit": 100000,
        "period": "YYYY-MM"
      }
    }

Monthly periods use UTC. Reaching a limit exactly is allowed; exceeding it is rejected without usage or idempotency writes.

## Pricing

All internal money uses integer micro-cents.

| Billable category | Pinned rate |
| --- | ---: |
| API call | 10 micro-cents per call |
| Normal input | 100,000 micro-cents per 1,000,000 tokens |
| Cached input | 25,000 micro-cents per 1,000,000 tokens |
| Output | 500,000 micro-cents per 1,000,000 tokens |
| Reasoning | 500,000 micro-cents per 1,000,000 tokens |

Each token category is priced separately. Division rounds upward whenever a nonzero category has a fractional micro-cent cost. The category costs are then summed; token categories are never combined under one rate.

For the documented 1,000 input, 200 cached input, 500 output, and 100 reasoning request:

- Input: 100 micro-cents
- Cached input: 5 micro-cents
- Output: 250 micro-cents
- Reasoning: 50 micro-cents
- AI-token total: 405 micro-cents
- API call: 10 micro-cents
- Total: 415 micro-cents

### GET /usage example

    curl http://localhost:3000/usage \
      -H "x-tenant-id: tenant_demo_free"

The response includes tenant identity, actual plan limits, subscription status, explicit UTC month boundaries, API/token used and remaining quantities, per-type micro-cent costs, and total cost. Costs are returned as JSON numbers only after safe-integer validation.

### Stripe test-mode Checkout

Set STRIPE_SECRET_KEY to an sk_test_ key, STRIPE_PRO_PRICE_ID to the recurring Pro test price, and APP_BASE_URL to the local application origin. Never use a live key.

    curl -X POST http://localhost:3000/billing/checkout \
      -H "x-tenant-id: tenant_demo_free"

The response contains checkoutUrl and sessionId. Open the hosted URL and use Stripe test-mode payment methods. Checkout creation may save a Stripe customer ID, but the tenant remains on its current plan/status until a verified webhook is implemented in Phase 8.

### Stripe webhook local testing

Use Stripe CLI in test mode and forward events to the local Fastify endpoint:

    stripe listen --forward-to localhost:3000/webhooks/stripe

Copy the displayed whsec_ signing secret to STRIPE_WEBHOOK_SECRET in the local .env file. Do not commit it. The endpoint verifies the exact raw request bytes and stripe-signature header before trusting metadata.

Useful test-mode lifecycle events are checkout.session.completed, customer.subscription.updated, and customer.subscription.deleted. Replaying the same Stripe event ID returns a duplicate acknowledgement without applying state twice.
