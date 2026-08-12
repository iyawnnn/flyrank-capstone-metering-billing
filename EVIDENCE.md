# Evidence

Verified locally on 2026-08-12 against PostgreSQL 16 from docker-compose.yml. Automated Stripe tests use an injected verifier/gateway and make no network requests. Real Stripe CLI proof is explicitly marked manual because secrets are intentionally absent.

## Metering proof

Command:

    npm test -- src/tests/generate.test.ts

Included in the full run: 12 generate/idempotency tests passed.

Verified assertions:

- One valid request creates exactly two UsageEvents.
- API_CALL quantity is 1.
- AI_TOKENS quantity for 1,000/200/500/100 is 1,800.
- Both rows share tenant, idempotency key, and canonical SHA-256 request hash.
- Usage and stored response commit in one serializable transaction.
- Four concurrent identical retries still produce one billable operation.

## Idempotency proof

The generate integration suite proved:

- Matching tenant/key/hash returns the byte-identical stored response.
- Matching retry leaves two UsageEvents and one IdempotencyKey.
- Changed-body reuse returns 409 and adds no usage.
- The same key succeeds independently for two tenants.
- Validation and unknown-tenant failures create neither usage nor idempotency rows.

Representative full-suite output:

    Test Files  8 passed (8)
    Tests       60 passed (60)

## Quota proof

The eight quota tests proved:

- 999 + 1 API call succeeds at the Free limit of 1,000.
- 99,999 + 1 AI token succeeds at the Free limit of 100,000.
- At-limit and over-limit requests return 429.
- Errors include usageType, used, requested, limit, and UTC YYYY-MM period.
- API_CALL is checked first if both quotas fail.
- Rejections create zero UsageEvent and zero IdempotencyKey rows.
- A Pro tenant uses 50,000/5,000,000 limits.
- Concurrent requests for one final slot produce one 200 and one 429.

Manual commands are in MANUAL_TESTING.md section 6.

## Pricing proof

Pinned rates:

| Category | Micro-cents |
| --- | ---: |
| API call | 10/call |
| Input | 100,000/million |
| Cached input | 25,000/million |
| Output | 500,000/million |
| Reasoning | 500,000/million |

Eight pricing tests passed. The 1,000/200/500/100 fixture produced:

    input=100
    cached=5
    output=250
    reasoning=50
    aiTokens=405
    apiCall=10
    total=415

One token in each nonzero category rounds upward to one micro-cent. Internal and stored money values are bigint; JSON conversion requires a safe integer.

## GET /usage rollup proof

Seven usage integration tests passed:

- Missing/unknown tenants return 400/404.
- Free and Pro limits match seeded plans.
- tenant_near_quota_free returns 999 API calls and 50,000 tokens.
- Period boundaries are explicit UTC month start/next-month start.
- An event one millisecond before period start is excluded.
- API/token quantity and cost totals aggregate separately.
- totalMicroCents equals API plus token cost.
- A successful /generate immediately appears as 1 call, 1,800 tokens, 10/405 costs, and 415 total.

Manual command: see MANUAL_TESTING.md section 7.

## Stripe Checkout proof

Seven mocked Checkout integration tests passed:

- Missing/unknown tenants return 400/404 without Stripe calls.
- Missing configuration returns sanitized 503.
- A customer is created with tenantId metadata and persisted when absent.
- Existing stripeCustomerId is reused.
- Session uses subscription mode and configured Pro price.
- Session and subscription metadata contain tenantId.
- Response contains checkoutUrl and sessionId.
- Tenant remains Free and not ACTIVE until a webhook.

TODO: paste manual Stripe CLI transcript after local demo run. Also add a redacted test-mode Checkout URL or Dashboard screenshot using evaluator-owned credentials. Follow MANUAL_TESTING.md section 8 and redact IDs/secrets.

## Stripe webhook signature proof

Thirteen webhook integration tests passed with an injected verifier:

- The verifier received a Buffer containing raw request bytes.
- Missing and forged signatures returned 400.
- Forged payload created zero StripeEvent, Subscription, or tenant mutations.
- Errors exposed neither secrets nor raw Stripe SDK details.

TODO: paste manual Stripe CLI transcript after local demo run. Real signed delivery requires local test-mode credentials. Follow MANUAL_TESTING.md sections 9 and 11.

## Duplicate webhook proof

Automated database assertions proved:

- Duplicate checkout.session.completed returns 200 with duplicate true.
- One StripeEvent and one Subscription remain.
- Duplicate customer.subscription.deleted returns 200 and applies cancellation once.
- Unknown verified events return 200 ignored with processedAt.
- Unresolvable verified events return 422 and roll back the event claim.

TODO: paste manual Stripe CLI transcript after local demo run. Resend proof requires a real test-mode event ID. Use:

    stripe events resend evt_test_event_id

Redact the actual event/customer/subscription identifiers in public evidence.

## Database and seed proof

Commands and results:

    npm run db:generate
    Prisma Client v6.19.3 generated successfully.

    npx prisma validate
    The schema at prisma/schema.prisma is valid.

    npx prisma migrate status
    2 migrations found.
    Database schema is up to date.

    npm run db:seed
    Seeded Free/Pro plans and three deterministic demo tenants.

Four seed tests proved rerun safety, two unique plans, three stable tenants, and deterministic near-quota totals.

## Test suite proof

Commands:

    npm run typecheck
    Exit code 0.

    npm run build
    Exit code 0.

    npm test
    Test Files  8 passed (8)
    Tests       60 passed (60)

Coverage command:

    npm run test:coverage
    Test Files  8 passed (8)
    Tests       60 passed (60)
    All files: 86.06% statements, 82.48% branches, 89.06% functions, 86.06% lines.

High-value domain coverage includes:

- Metering service: 100% statements/branches/functions/lines.
- Quota service: 100% statements/lines/functions.
- Tenant repository: 100%.
- Usage service: 100%.
- Generate routes: 97.53% statements.
- Pricing service: 94.87% statements.
- Webhook service: 79.72% statements.

Known coverage limitations: the process entrypoint, real Stripe SDK network adapter, configuration-only/types-only files, and types-only files are not meaningfully exercised. Business-critical behavior is covered through injected Fastify/PostgreSQL integration tests.

## Setup/run proof

Verified:

    docker compose up -d postgres
    PostgreSQL container started and passed its configured health check.

    npm run db:migrate
    Initial schema applied.

    npm run db:seed
    Seed completed and reran without duplicate fixtures.

The compiled build succeeded. A direct HTTP startup probe from the managed Windows process harness was inconclusive because the detached process exited without captured diagnostics; the Fastify app itself is exercised through injection in all route suites, including GET /health. Manual npm run dev plus curl proof remains in MANUAL_TESTING.md section 3 and should be captured during the final demo.

## Secret hygiene proof

Ignore verification:

    .env       ignored by .gitignore
    node_modules ignored
    dist       ignored
    coverage   ignored
    *.log      ignored
    *.sqlite   ignored

Repository scan result:

    No credential-shaped live/test Stripe secrets found.
    No sk_live_ or rk_live_ patterns found.
    .env does not exist in the workspace.
    .env.example contains placeholders only.

Dependency audit:

    npm audit
    found 0 vulnerabilities

Stripe route tests also assert sanitized configuration/signature failures. Tenant routes return only the tenant named by x-tenant-id; tests verify cross-tenant idempotency isolation and tenant-specific plan/usage reads.

## Manual evidence still required

Because the public repository contains no Stripe credentials, these artifacts cannot be generated safely in automation:

- A redacted Stripe test-mode Checkout page/session.
- A Stripe CLI signed checkout.session.completed delivery returning 200.
- A redacted post-webhook /usage response showing Pro/ACTIVE.
- A resend of the same real event showing duplicate true.
- A terminal screenshot of npm run dev plus curl /health.

Use MANUAL_TESTING.md and paste redacted outputs here or attach them to the final portfolio submission. Never include secret keys, webhook signing secrets, full signatures, or customer-identifying data.


