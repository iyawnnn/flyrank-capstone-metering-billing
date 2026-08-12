# Manual Testing and Demo Guide

These commands use single-line curl.exe syntax for Windows PowerShell. Replace only local placeholder values; never paste secrets into committed files or screenshots.

## 1. Install and configure

    npm install
    Copy-Item .env.example .env

For non-Stripe demonstrations, DATABASE_URL and PORT are sufficient. For Checkout and webhooks, set local test-mode values in .env: STRIPE_SECRET_KEY, STRIPE_PRO_PRICE_ID, APP_BASE_URL, and STRIPE_WEBHOOK_SECRET. Do not use live keys.

## 2. Start PostgreSQL, migrate, and seed

    docker compose up -d postgres
    npm run db:generate
    npm run db:migrate
    npm run db:seed

The seed can be rerun safely. It restores the named seed fixtures to their documented plan/status and current-month usage quantities.

## 3. Start Fastify and check health

In one terminal:

    npm run dev

In another terminal:

    curl.exe http://localhost:3000/health

Expected:

    {"status":"ok"}

## 4. Successful billable generation

    curl.exe -X POST http://localhost:3000/generate -H "content-type: application/json" -H "x-tenant-id: tenant_demo_free" -H "idempotency-key: manual-demo-1" -d "{\"inputTokens\":1000,\"cachedInputTokens\":200,\"outputTokens\":500,\"reasoningTokens\":100}"

Expected usage is one API call and 1,800 AI tokens. Expected cost is 10 API micro-cents, 405 token micro-cents, and 415 total.

## 5. Idempotent retry

Run the exact command from step 4 again. It must return the exact original body. Then inspect:

    curl.exe http://localhost:3000/usage -H "x-tenant-id: tenant_demo_free"

The retry must not add another API call or token event. For a conflict, reuse manual-demo-1 but change one token field. Expected: HTTP 409 with IDEMPOTENCY_KEY_CONFLICT.

## 6. Quota boundary and rejection

Reseed for deterministic near-quota state:

    npm run db:seed

The tenant begins at 999/1,000 calls. Reach exactly the limit:

    curl.exe -X POST http://localhost:3000/generate -H "content-type: application/json" -H "x-tenant-id: tenant_near_quota_free" -H "idempotency-key: manual-quota-final" -d "{\"inputTokens\":1,\"cachedInputTokens\":0,\"outputTokens\":0,\"reasoningTokens\":0}"

Then exceed it with a new key:

    curl.exe -i -X POST http://localhost:3000/generate -H "content-type: application/json" -H "x-tenant-id: tenant_near_quota_free" -H "idempotency-key: manual-quota-over" -d "{\"inputTokens\":1,\"cachedInputTokens\":0,\"outputTokens\":0,\"reasoningTokens\":0}"

Expected: HTTP 429 with API_CALL, used 1000, requested 1, limit 1000, and UTC YYYY-MM. The rejected key creates no usage or successful idempotency record.

## 7. Usage rollup

    curl.exe http://localhost:3000/usage -H "x-tenant-id: tenant_near_quota_free"

Verify tenant/plan/status, UTC boundaries, API/token used/limit/remaining, per-type costs, and total cost.

## 8. Stripe Checkout test mode

With local Stripe test configuration:

    curl.exe -X POST http://localhost:3000/billing/checkout -H "x-tenant-id: tenant_demo_free"

Expected: checkoutUrl and a cs_test_ sessionId. Open the URL and use a Stripe test payment method. Before the verified webhook, GET /usage must still show the prior plan/status.

## 9. Stripe CLI webhook forwarding

Install and authenticate Stripe CLI:

    stripe login
    stripe listen --forward-to localhost:3000/webhooks/stripe

Copy the displayed whsec_ value to local .env and restart Fastify. Complete Checkout to produce checkout.session.completed. Generic Stripe CLI fixtures may lack seeded tenant metadata; an unresolvable verified supported event correctly returns controlled 422 and rolls back its claim.

Capture redacted proof showing:

- Stripe CLI delivery received HTTP 200 for the completed Checkout.
- GET /usage reports Pro and ACTIVE afterward.
- A Subscription row contains test customer/subscription IDs.
- No secret, full signature, or customer-identifying value is visible.

## 10. Duplicate verified event

Resend the exact event ID shown by Stripe CLI or Dashboard:

    stripe events resend evt_test_event_id

The first processing response has duplicate false. A resend has duplicate true and does not create a second StripeEvent or repeat the projection.

## 11. Safe forged-signature check

This payload is deliberately unsigned and contains no secret:

    curl.exe -i -X POST http://localhost:3000/webhooks/stripe -H "content-type: application/json" -H "stripe-signature: forged" -d "{\"id\":\"evt_forged_demo\",\"type\":\"checkout.session.completed\",\"data\":{\"object\":{\"metadata\":{\"tenantId\":\"tenant_demo_free\"}}}}"

Expected: HTTP 400 with INVALID_STRIPE_SIGNATURE. Tenant state and StripeEvent count remain unchanged.

## 12. Automated verification

    npm run typecheck
    npm run build
    npm test
    npm run test:coverage
    npm run db:generate
    npx prisma validate
    npx prisma migrate status
    npm audit

Automated tests mock Stripe, make no network calls, and prove raw Buffer delivery, forged rejection, duplicate processing, and status mapping. Real Stripe CLI delivery remains manual because credentials are intentionally absent.

## Reset

    npm run db:seed

This is not a full database reset: application-created rows outside stable seed IDs remain. Use a disposable local database for repeated end-to-end demos.
