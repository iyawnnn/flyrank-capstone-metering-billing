# API Specification

Fastify serves the HTTP API. All responses are JSON except that Stripe sends the future webhook request as raw bytes. Tenant endpoints use `x-tenant-id`. Planned error bodies use `{ "error": { "code": "...", "message": "...", "details": {} } }`.

## `GET /health`

**Purpose:** Process liveness check. **Headers/body:** None. **Success `200`:** `{ "status": "ok" }`. **Errors:** unexpected `500`. **Notes:** This endpoint does not check database readiness.

## `POST /seed`

**Purpose:** Idempotently create Free/Pro plans, a demo tenant, and a near-quota tenant for local demonstrations. **Headers/body:** No body; disabled outside local/test environments. **Success `200`:** IDs/names of seeded records and whether each was created or reused. **Errors:** `403` when disabled; validation/configuration `400`; unexpected `500`. **Notes:** Never a production administration API.

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

Only sk_test_ secret keys are accepted by environment validation. Errors never return keys or Stripe exception details. Checkout creation does not change planId or subscriptionStatus and does not grant Pro access; only a future verified Phase 8 webhook may do that.
## `POST /webhooks/stripe`

**Purpose:** Verify and consume supported Stripe subscription events.

**Headers:** Required `stripe-signature`; `Content-Type: application/json`. **Body:** Raw, unmodified Stripe payload.

**Success `200`:** `{ "received": true, "duplicate": false }`; duplicate delivery returns the same with `duplicate: true` and performs no second state transition.

**Errors:** `400` missing/invalid signature or malformed payload; `500` transient processing failure so Stripe may retry. **Notes:** Raw-body middleware must precede normal JSON parsing. Supported types are `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Only verified events may update subscription/plan status; unhandled verified types are acknowledged without a domain update.








