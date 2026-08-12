# Architecture

## Layered design

Fastify routes/controllers translate HTTP headers, bodies, and service outcomes. Zod validates external input. Services coordinate business invariants and transactions. Repositories contain Prisma queries and always scope tenant-owned records by tenant ID. Configuration centralizes validated environment values and pinned pricing. Middleware provides tenant context and consistent JSON errors.

```text
route/controller -> service -> repository -> Prisma -> PostgreSQL
                        |          |
                  pricing/quota   constraints + transactions
```

## `POST /generate` request flow

1. Require `x-tenant-id` and `idempotency-key`; validate token counts.
2. Load the tenant and plan.
3. Hash a canonical form of the validated request.
4. In a database transaction, claim the tenant/key pair.
5. If the stored hash matches, return the stored response; if not, return `409`.
6. Read current-period API/token usage and test requested usage against both limits.
7. Reject an exceeded quota without recording usage.
8. Price each token category with integer math.
9. Record API-call and AI-token usage and store the original response atomically.
10. Return the simulated generation response.

The final transaction design in Phase 3 must prevent two concurrent requests from both claiming the same key or exceeding a quota from stale reads.

## `GET /usage` read flow

Resolve the tenant, calculate the UTC calendar-month period, aggregate its usage events by type and total cost, join its plan and subscription status, and return used/limit/cost values plus period boundaries. Every predicate includes the tenant ID.

## Stripe Checkout flow

Resolve the tenant; reuse its Stripe customer or create one in test mode; persist the customer ID; create a subscription-mode Checkout Session for the configured Pro price; attach `tenantId` metadata; return its hosted URL. Checkout creation does not itself grant Pro access.

## Stripe webhook flow

The future Fastify webhook route will use a route-scoped raw-body mechanism so the original bytes are available before JSON parsing. Stripe verifies the payload/signature with `STRIPE_WEBHOOK_SECRET`. Invalid signatures return `400` without writes. A verified event is processed transactionally: claim its unique event ID, map the supported event to a tenant, upsert subscription state, update the tenant plan/status, and mark processing complete. A duplicate ID returns success without applying state twice.

## Idempotency flow

Identity is `(tenantId, key)`, not the key globally. The request hash binds the key to one canonical request. The original HTTP status and body are persisted for exact replay. The uniqueness constraint is the concurrency backstop; usage writes and response persistence share the same transaction.

## Tenant isolation

`x-tenant-id` establishes context for this capstone; it is not authentication. Repositories never fetch tenant-owned data by record ID alone. Composite constraints, foreign keys, and tenant predicates prevent cross-tenant idempotency or usage leakage. Production authentication/authorization is explicitly out of scope.

## Error strategy

Expected domain errors map to JSON with a stable code and message. Validation uses `400`, missing tenants use `404`, idempotency conflicts use `409`, exceeded quotas use `429`, and payment/upgrade-required outcomes may use `402`. Unexpected errors become a generic `500` and do not expose secrets or stack traces. Quota errors include quota type, current usage, limit, requested quantity, and suggested action.



