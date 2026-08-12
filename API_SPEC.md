# API Specification

Fastify serves the HTTP API. Responses are JSON; the Stripe webhook request is verified from its raw bytes before event data is trusted. Tenant endpoints use x-tenant-id. Domain errors use stable JSON codes and messages.

Fastify serves the HTTP API. Responses are JSON; the Stripe webhook request is verified from its raw bytes before its event data is trusted. Tenant endpoints use x-tenant-id. Domain errors use stable JSON codes and messages.

## `GET /health`

**Purpose:** Process liveness check. **Headers/body:** None. **Success `200`:** `{ "status": "ok" }`. **Errors:** unexpected `500`. **Notes:** This endpoint does not check database readiness.

## POST /generate

**Status:** Implemented in Phase 3.

**Purpose:** Simulate one billable AI generation and atomically record its usage.

**Headers:** Required x-tenant-id and idempotency-key. Blank values are invalid.

**Body:**

    {
      "inputTokens": 1000,
      "cachedInputTokens": 200,
      "outputTokens": 500,
      "reasoningTokens": 100
    }

All four fields are required nonnegative safe integers, unknown fields are rejected, at least one category must be greater than zero, and the summed token quantity must remain a safe integer.

**Success 200:**

    {
      "tenantId": "tenant_demo_free",
      "idempotencyKey": "demo-key-1",
      "simulated": true,
      "usage": {
        "apiCalls": 1,
        "aiTokens": 1800
      },
      "cost": {
        "apiCallMicroCents": 10,
        "aiTokensMicroCents": 405,
        "totalMicroCents": 415
      },
      "message": "Simulated generation completed."
    }

A new request writes exactly one API_CALL event with quantity 1, one AI_TOKENS event with the sum of all four categories, and one tenant-scoped idempotency response. Both events share the key and canonical SHA-256 request hash. The API event stores 10 micro-cents. Token categories are priced separately using pinned per-million rates and each nonzero fractional category cost rounds up to the next micro-cent.

**Errors:** 400 for missing headers or invalid body; 404 for an unknown tenant; 409 when the same tenant/key is reused with a different validated body; 429 when a projected monthly quota is exceeded; 500 for unexpected failures. Payment-required behavior is not active.

**Quota enforcement:** Current usage is the sum of UsageEvent quantities for the tenant in the UTC calendar-month window [month start, next month start). A projected total equal to the plan limit succeeds; a projected total greater than the limit returns 429. API_CALL is evaluated before AI_TOKENS when both would fail.

**Quota error 429:**

    {
      "error": "quota_exceeded",
      "message": "AI token quota exceeded for the current month.",
      "quota": {
        "usageType": "AI_TOKENS",
        "used": 100000,
        "requested": 1,
        "limit": 100000,
        "period": "2026-08"
      }
    }

A quota rejection creates neither usage events nor an idempotency response. A previously successful matching retry is replayed before quota evaluation, so it remains available after the original request reaches the limit.
The same tenant/key/hash replays the originally stored status and stable response without additional events. The same key is independent across tenants. Writes run in a serializable transaction with bounded retry handling for serialization and uniqueness races.
## GET /usage

**Status:** Implemented in Phase 6.

**Purpose:** Return the tenant-scoped current UTC calendar-month usage, plan limits, remaining quota, and integer micro-cent costs.

**Headers:** Required x-tenant-id. **Body:** None.

**Success 200:**

    {
      "tenant": {
        "id": "tenant_demo_free",
        "name": "Demo Free Tenant"
      },
      "plan": {
        "name": "FREE",
        "monthlyApiCallLimit": 1000,
        "monthlyTokenLimit": 100000
      },
      "subscriptionStatus": "FREE",
      "period": {
        "start": "2026-08-01T00:00:00.000Z",
        "end": "2026-09-01T00:00:00.000Z"
      },
      "usage": {
        "apiCalls": {
          "used": 10,
          "limit": 1000,
          "remaining": 990,
          "costMicroCents": 100
        },
        "aiTokens": {
          "used": 18000,
          "limit": 100000,
          "remaining": 82000,
          "costMicroCents": 4050
        }
      },
      "cost": {
        "apiCallMicroCents": 100,
        "aiTokensMicroCents": 4050,
        "totalMicroCents": 4150
      }
    }

**Errors:** 400 for a missing/blank tenant header; 404 for an unknown tenant; 500 for unexpected failures or a cost total outside the JSON safe-integer range.

**Notes:** UsageEvent quantities and costs are grouped by usage type in the UTC window [period.start, period.end). Start is inclusive and end is exclusive. Remaining quota is clamped at zero if historical/imported data is already over a plan limit. Database costs remain BIGINT; response costs are JSON numbers only after safe-integer validation.
## POST /billing/checkout

**Status:** Implemented in Phase 7.

**Purpose:** Create a Stripe test-mode subscription Checkout Session for the configured Pro price.

**Headers:** Required x-tenant-id. **Body:** None.

**Success 200:**

    {
      "checkoutUrl": "https://checkout.stripe.com/...",
      "sessionId": "cs_test_..."
    }

**Errors:** 400 for a missing/blank tenant header; 404 for an unknown tenant; 503 when test-mode Stripe configuration is absent or invalid; 502 when Stripe customer/Session creation fails; 500 for unexpected persistence failures.

**Behavior:** The service reuses Tenant.stripeCustomerId when present. Otherwise it creates a Stripe customer with tenantId metadata and persists the returned customer ID. It then creates a Session with mode subscription, one configured STRIPE_PRO_PRICE_ID line item, tenantId in both Session and subscription metadata, and APP_BASE_URL-derived success/cancel URLs.

Only sk_test_ secret keys are accepted by environment validation. Errors never return keys or Stripe exception details. Checkout creation does not change planId or subscriptionStatus and does not grant Pro access; only the verified webhook endpoint may do that.
## POST /webhooks/stripe

**Status:** Implemented in Phase 8.

**Purpose:** Verify and transactionally consume Stripe subscription lifecycle events.

**Headers:** Required stripe-signature and Content-Type application/json. **Body:** The exact unmodified Stripe JSON bytes.

**Success 200:**

    {
      "received": true,
      "duplicate": false,
      "ignored": false
    }

A duplicate event returns duplicate true. An unsupported but verified event returns ignored true.

**Errors:** 400 for a missing/invalid signature or non-raw payload; 503 when STRIPE_WEBHOOK_SECRET is absent/invalid; 422 when a verified supported event cannot resolve required tenant/plan/subscription data; 500 for unexpected transient database failures.

**Raw-body verification:** The Fastify app replaces its JSON parser with a buffer parser. Only this exact route receives the Buffer; all other JSON routes are parsed normally. Stripe SDK constructEvent receives the Buffer, stripe-signature, and STRIPE_WEBHOOK_SECRET before any event data is trusted.

**Deduplication:** A serializable transaction checks and creates unique StripeEvent.stripeEventId, applies all projections, and sets processedAt. A duplicate returns 200 without another state transition. Any processing failure rolls back both the claim and domain writes.

**Supported events:**

- checkout.session.completed: requires complete status and verified Session metadata tenantId, customer, and subscription IDs; upserts Subscription and sets the tenant to Pro/ACTIVE.
- customer.subscription.updated: resolves by metadata tenantId, then stored subscription ID, then customer ID; updates status and period timestamps.
- customer.subscription.deleted: resolves the same way, marks a stored Subscription CANCELED when present, and sets the tenant to Free/CANCELED.
- Other verified event types are recorded and acknowledged as ignored.

**Status mapping:**

| Stripe status | Tenant plan | Tenant/Subscription status |
| --- | --- | --- |
| active, trialing | Pro | ACTIVE |
| past_due | Pro | PAST_DUE |
| canceled, unpaid | Free | CANCELED |
| incomplete, incomplete_expired | Free | INCOMPLETE |

No query parameter or unverified request field is used to choose a tenant. Errors do not expose webhook secrets or Stripe SDK details.

