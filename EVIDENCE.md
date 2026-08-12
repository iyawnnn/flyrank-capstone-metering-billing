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


## Phase 4 proof

Verified on 2026-08-12 against the Docker Compose PostgreSQL service:

- npm run typecheck and npm run build passed.
- npm test passed 4 files and 25 tests: 8 quota, 12 generate/idempotency, 4 seed, and 1 health test.
- Free tenants successfully reached exactly 1,000 API calls and exactly 100,000 AI tokens.
- At-limit and over-limit requests returned 429 with usageType, used, requested, limit, and UTC YYYY-MM period.
- Database assertions confirmed rejected requests created zero UsageEvent and zero IdempotencyKey rows.
- A Pro tenant above both Free thresholds succeeded under its 50,000-call and 5,000,000-token limits.
- Two concurrent requests for one remaining API-call slot produced one 200, one 429, two usage rows, and one idempotency row.
- npm run db:generate, npx prisma validate, and npx prisma migrate status passed; the database is up to date.


## Phase 5 proof

Verified on 2026-08-12 against the Docker Compose PostgreSQL service:

- npm run typecheck and npm run build passed.
- npm test passed 5 files and 33 tests: 8 pricing, 12 generate/idempotency, 8 quota, 4 seed, and 1 health test.
- Pure pricing assertions confirmed rates of 10 per API call and 100,000/25,000/500,000 micro-cents per million input/cached/output tokens.
- Reasoning matched the 500,000 output rate.
- The 1,000/200/500/100 fixture produced category costs 100/5/250/50, AI-token cost 405, API cost 10, and total cost 415.
- One token in each category produced one micro-cent per category, proving ceiling rounding.
- Integration assertions confirmed UsageEvent BIGINT costs of 10 and 405 and an exact replayed response total of 415.
- Existing quota, idempotency, concurrency, seed, and health tests remained green.
- npm run db:generate, npx prisma validate, and npx prisma migrate status passed; the database is up to date.


## Phase 6 proof

Verified on 2026-08-12 against the Docker Compose PostgreSQL service:

- npm run typecheck and npm run build passed.
- npm test passed 6 files and 40 tests: 7 usage, 8 pricing, 12 generate/idempotency, 8 quota, 4 seed, and 1 health test.
- Missing and unknown tenant tests returned clean 400 and 404 responses.
- Seed assertions confirmed Free limits 1,000/100,000, Pro limits 50,000/5,000,000, and near-quota totals 999/50,000.
- The response exposed exact UTC start/end boundaries and excluded records one millisecond before period start.
- Grouped aggregation returned exact API/token quantities, per-type costs, remaining quotas, and summed total cost.
- A priced POST /generate was immediately reflected as 1 API call, 1,800 AI tokens, costs 10/405, and total 415.
- Existing pricing, quota, idempotency/concurrency, seed, and health suites remained green.
- npm run db:generate, npx prisma validate, and npx prisma migrate status passed; the database is up to date.

