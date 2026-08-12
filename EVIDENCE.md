# Evidence

Add dated, reproducible proof as phases finish. Include command/request, relevant output, assertion demonstrated, and commit reference. Never paste secrets.

## Metering proof

_Pending._

## Idempotency proof

_Pending._

## Quota proof

_Pending._

## Pricing proof

_Pending._

## Stripe Checkout proof

_Pending._

## Stripe webhook signature proof

_Pending._

## Duplicate webhook proof

_Pending._

## Usage rollup proof

_Pending._

## Test suite proof

_Pending._

## Setup/run proof

_Pending._


### Phase 2 database and seed proof

Verified on 2026-08-12 against the Docker Compose PostgreSQL 16 service:

- npm run db:generate: Prisma Client v6.19.3 generated successfully.
- npm run db:migrate -- --name initial_schema: initial schema created and applied.
- npx prisma migrate deploy: numeric check migration applied; database reported all migrations successful.
- npm run db:seed: Free/Pro plans and three deterministic demo tenants seeded.
- npm test: 2 test files and 5 tests passed, including a second seed run.
- Direct Prisma query returned Free limits 1,000/100,000 with two tenants and Pro limits 50,000/5,000,000 with one tenant.
- Direct Prisma aggregation returned 999 API calls and 50,000 AI tokens for tenant_near_quota_free.


## Phase 3 proof

Verified on 2026-08-12 against the Docker Compose PostgreSQL service:

- npm run typecheck and npm run build passed.
- npm test passed 3 files and 17 tests: 12 generate tests, 4 seed tests, and 1 health test.
- A 1,000 input + 200 cached input + 500 output + 100 reasoning request returned 1,800 AI tokens and persisted exactly one API_CALL plus one AI_TOKENS event.
- Matching retries returned the byte-identical stored body while event count remained two.
- Changed-body reuse returned 409 while event count remained two.
- The same key created independent idempotency records for Free and Pro tenants.
- Four concurrent matching requests all returned 200 while database event count remained two.
- npm run db:generate and npx prisma validate passed.

