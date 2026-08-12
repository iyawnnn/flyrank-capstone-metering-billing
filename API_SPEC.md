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
      "message": "Simulated generation completed."
    }

A new request writes exactly one API_CALL event with quantity 1, one AI_TOKENS event with the sum of all four categories, and one tenant-scoped idempotency response. Both events share the key and canonical SHA-256 request hash. Phase 3 stores costMicroCents as zero.

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
## `GET /usage`

**Purpose:** Return the current UTC calendar-month rollup.

**Headers:** Required `x-tenant-id`. **Body:** None.

**Success `200`:**

```json
{
  "tenantId": "tenant-id",
  "plan": "FREE",
  "subscriptionStatus": "inactive",
  "usage": {
    "apiCalls": { "used": 12, "limit": 1000 },
    "aiTokens": { "used": 3400, "limit": 100000 },
    "totalCostMicroCents": 1234
  },
  "period": { "start": "2026-08-01T00:00:00.000Z", "end": "2026-09-01T00:00:00.000Z" }
}
```

**Errors:** `400` missing tenant header; `404` tenant; `500` unexpected. **Notes:** Period end is exclusive; only tenant-scoped events in `[start, end)` are included.

## `POST /billing/checkout`

**Purpose:** Create a Stripe test-mode Pro subscription Checkout Session.

**Headers:** Required `x-tenant-id`. **Body:** None.

**Success `200`:** `{ "checkoutUrl": "https://checkout.stripe.com/..." }`.

**Errors:** `400` missing header/configuration; `404` tenant; `409` tenant already has an active Pro subscription; `502` Stripe failure; `500` unexpected. **Notes:** Reuses or creates the tenant’s Stripe customer, uses `STRIPE_PRO_PRICE_ID`, includes `tenantId` metadata, and does not update plan state before a verified webhook.

## `POST /webhooks/stripe`

**Purpose:** Verify and consume supported Stripe subscription events.

**Headers:** Required `stripe-signature`; `Content-Type: application/json`. **Body:** Raw, unmodified Stripe payload.

**Success `200`:** `{ "received": true, "duplicate": false }`; duplicate delivery returns the same with `duplicate: true` and performs no second state transition.

**Errors:** `400` missing/invalid signature or malformed payload; `500` transient processing failure so Stripe may retry. **Notes:** Raw-body middleware must precede normal JSON parsing. Supported types are `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Only verified events may update subscription/plan status; unhandled verified types are acknowledged without a domain update.





