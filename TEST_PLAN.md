# Test Plan

Tests use Vitest, deterministic timestamps, isolated PostgreSQL records, mocked Stripe SDK boundaries, and real service/repository behavior where practical. Each database test cleans only its own fixtures.

## Metering and idempotency

- Send an identical request twice with one tenant/key; assert exactly one API-call event and one token event (one billable operation).
- Assert the duplicate response deeply equals the stored original response/status.
- Reuse the key with a changed body; assert `409` and no additional usage.
- Use the same key for two tenants; assert independent successful operations.
- Race identical requests; assert the unique constraint/transaction produces one operation.

## Quotas

- Project usage just under each limit; success.
- Project usage exactly to each limit; success (documented inclusive boundary).
- Project one unit over API-call and token limits separately; `429`, clear details, no usage write.
- Assert any `402` upgrade-required policy is distinguishable from raw quota exhaustion.

## Pricing

- API-call cost uses pinned integer math.
- Input, cached input, and output categories produce the expected deterministic total.
- Cached input receives its cheaper configured rate rather than normal input pricing.
- Reasoning tokens receive the output-token rate.
- Category costs are calculated separately before summing; no floating point enters money values.
- Zero-token request behavior follows the validated contract while still counting an API call.

## Usage and validation

- `/usage` returns correct tenant, plan, subscription status, used/limit/cost, and UTC period.
- Exclude prior/future period and other-tenant events.
- Missing headers, negative/fractional/unsafe token values, unknown fields (per chosen strictness), and malformed JSON return clean 4xx JSON rather than `500`.

## Stripe

- Forged/missing signature returns `400`, creates no StripeEvent, and changes no tenant/subscription state.
- Valid duplicate Stripe event returns success but applies its state transition once.
- Verified `checkout.session.completed` maps metadata to the tenant and flips Free to Pro with subscription state.
- Verified subscription update synchronizes status and period.
- Verified subscription deletion returns the tenant to the documented Free/inactive state.
- Unhandled verified event is acknowledged without mutation.
- Confirm the raw payload, not parsed/re-serialized JSON, is supplied to signature verification.

## Evidence expectations

Capture concise command output for full suite/coverage, targeted idempotency/quota/pricing/webhook tests, and manual HTTP demonstrations. Redact all secrets, signatures, Checkout URLs as appropriate, and customer-identifying values before adding evidence.


## Fastify HTTP foundation

- Build the service through the app factory without starting a network listener.
- Use Fastify inject to call GET /health.
- Assert status 200 and the exact JSON body with status set to ok.
- Close each Fastify instance after its test.

## Phase 3 metering and idempotency coverage

Implemented integration coverage verifies:

- Missing tenant and idempotency headers return 400.
- Unknown tenant returns 404.
- Negative, fractional, all-zero, and incomplete bodies return 400 with no writes.
- A new request writes one API_CALL and one summed AI_TOKENS event.
- A matching retry returns the byte-identical original response and keeps two events.
- A changed body with the same tenant/key returns 409 and keeps two events.
- The same key succeeds independently for two tenants.
- Four concurrent identical attempts return one response and produce one billable operation.
- Existing Phase 2 seed tests continue to pass.

## Phase 4 monthly quota coverage

Implemented integration coverage verifies:

- Free usage at 999 API calls may record the 1,000th call.
- Free usage at or above 1,000 API calls rejects another call with 429.
- Free usage at 99,999 AI tokens may record the 100,000th token.
- Free usage at 100,000 AI tokens rejects additional tokens with 429.
- Rejections persist no request usage and no successful idempotency response.
- Error details contain usageType, used, requested, limit, and YYYY-MM UTC period.
- API_CALL is the deterministic first error if both quotas would fail.
- A Pro tenant above Free thresholds remains allowed under Pro limits.
- Successful idempotency replay happens before quota evaluation.
- Concurrent requests at the last available API-call slot produce one success and one rejection.

## Phase 5 pricing coverage

Implemented deterministic tests verify:

- One API call costs exactly 10 micro-cents.
- One million normal input tokens cost 100,000 micro-cents.
- One million cached input tokens cost 25,000 micro-cents.
- One million output tokens cost 500,000 micro-cents.
- Reasoning tokens use the output rate.
- Mixed categories are ceiling-priced separately before summing.
- A nonzero fractional cost in any category rounds up to one micro-cent.
- All internal pricing outputs are bigint values.
- POST /generate stores 10 and the exact token cost on its two events.
- The response and exact idempotent replay contain the same cost summary.
- Existing quota, idempotency, seed, and health behavior remains covered.

## Phase 6 usage rollup coverage

Implemented integration coverage verifies:

- Missing tenant header returns 400 and unknown tenant returns 404.
- Demo Free and Pro tenants return their actual plan limits and statuses.
- The near-quota seed returns 999 API calls and 50,000 AI tokens.
- Period start is UTC-month inclusive and period end is next-month exclusive.
- API_CALL and AI_TOKENS quantities and costs aggregate independently.
- Total cost equals the two usage-type cost totals.
- Remaining quota is calculated per usage type and clamped at zero.
- Usage immediately before the current period is excluded.
- A successful priced POST /generate is visible in the next GET /usage.
- Existing pricing, quota, idempotency, seed, and health suites remain covered.

## Phase 7 Stripe Checkout coverage

Mocked integration coverage verifies:

- Missing tenant header returns 400 and unknown tenant returns 404 without Stripe calls.
- Missing or invalid Checkout configuration returns a sanitized 503.
- A tenant without stripeCustomerId gets a customer with tenantId metadata and persists its ID.
- A tenant with stripeCustomerId reuses it without another customer call.
- Checkout uses subscription mode and one STRIPE_PRO_PRICE_ID line item.
- Session and subscription metadata both contain tenantId.
- Success and cancel URLs derive from APP_BASE_URL.
- The response contains checkoutUrl and sessionId.
- Checkout creation leaves planId, Free plan, and subscriptionStatus unchanged.
- No real Stripe network call occurs during npm test.
