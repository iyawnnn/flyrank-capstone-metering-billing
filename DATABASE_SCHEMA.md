# Database Schema

Phase 2 implements this contract in prisma/schema.prisma and the initial PostgreSQL migration.

## Enums

- PlanName: FREE, PRO
- UsageType: API_CALL, AI_TOKENS
- SubscriptionStatus: FREE, ACTIVE, PAST_DUE, CANCELED, INCOMPLETE

## Models

### Plan

Fields: id, unique enum name, monthlyApiCallLimit, monthlyTokenLimit, nullable stripePriceId, createdAt, and updatedAt. A Plan has many tenants.

| Plan | Monthly API calls | Monthly AI tokens |
| --- | ---: | ---: |
| Free | 1,000 | 100,000 |
| Pro | 50,000 | 5,000,000 |

The Pro seed uses STRIPE_PRO_PRICE_ID when present and the non-secret price_test_pro_placeholder otherwise.

### Tenant

Fields: id, name, planId, nullable unique stripeCustomerId, subscriptionStatus, createdAt, and updatedAt. A tenant belongs to one Plan and has many Subscription records, UsageEvents, and IdempotencyKeys. Stable seed IDs provide deterministic tenant lookup without imposing global uniqueness on display names.

### Subscription

Fields: id, tenantId, nullable unique stripeSubscriptionId, stripeCustomerId, status, nullable currentPeriodStart, nullable currentPeriodEnd, createdAt, and updatedAt. It belongs to a Tenant. Multiple historical/current records are permitted; Stripe event handling will define current-record behavior in Phase 8.

### UsageEvent

Fields: id, tenantId, usageType, positive quantity, idempotencyKey, requestHash, nonnegative costMicroCents stored as PostgreSQL BIGINT, optional JSON metadata, and createdAt. It belongs to a Tenant. One event may represent a quantity greater than one; the near-quota fixture therefore stores 999 API calls as one deterministic event.

### IdempotencyKey

Fields: id, tenantId, key, requestHash, responseStatus, JSON responseBody, and createdAt. It belongs to a Tenant and is unique on (tenantId, key).

### StripeEvent

Fields: id, unique stripeEventId, type, nullable processedAt, and createdAt. The external event ID is the later duplicate-delivery guard.

## Constraints and indexes

- Unique Plan.name
- Unique nullable Tenant.stripeCustomerId (PostgreSQL permits multiple NULL values)
- Unique nullable Subscription.stripeSubscriptionId
- Unique StripeEvent.stripeEventId
- Unique IdempotencyKey(tenantId, key)
- Index Tenant(planId)
- Index Subscription(tenantId)
- Index UsageEvent(tenantId, createdAt)
- Index UsageEvent(tenantId, usageType)
- Foreign keys from Tenant to Plan and from Subscription, UsageEvent, and IdempotencyKey to Tenant
- Cascading deletes for tenant-owned child rows
- Migration-level checks require positive usage quantity and nonnegative micro-cent cost

## Time and money

Timestamps are stored in PostgreSQL and interpreted as UTC. Usage periods use UTC calendar months with an exclusive end. Cost is an integer BIGINT number of micro-cents; floating-point money is prohibited.

## Seed identities

- tenant_demo_free: Free, subscription status FREE
- tenant_demo_pro: Pro, subscription status ACTIVE
- tenant_near_quota_free: Free, with current-month quantities of 999 API calls and 50,000 AI tokens

The script uses upserts with stable IDs, so rerunning it updates these fixtures rather than duplicating them.
