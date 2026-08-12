# Build Log

Use one entry per meaningful work session. Keep failures and corrections: they demonstrate engineering judgment.

## Entry template

### Date

YYYY-MM-DD

### What was built

- 

### AI assistance used

- Prompt/task delegated:
- Output used:

### What AI got wrong

- 

### What was changed manually

- 

### Decisions made

- Decision:
- Reason/tradeoff:

### Tests/evidence added

- Test/command:
- Evidence location:

---

## 2026-08-12 â€” Phase 1 scaffold

### What was built

- Added project tooling, Dockerized PostgreSQL, minimal HTTP health endpoint, Prisma placeholder, layered folders, and capstone documentation.

### AI assistance used

- Used AI to translate the capstone brief into an explicit phased plan, API contract, architecture flows, and test checklist.

### What AI got wrong

- Nothing recorded yet; implementation phases will validate the planned contracts.

### What was changed manually

- Pending maintainer review.

### Decisions made

- Exact quota limit is inclusive: a request that reaches the limit succeeds; only projected usage above it fails.
- Use UTC calendar months with an exclusive period end.
- Keep the Prisma schema model-free until Phase 2 review, per the requested first-task boundary.

### Tests/evidence added

- Added a smoke test proving the Vitest scaffold loads; full verification output belongs in the setup/run evidence after dependency installation.


---

## 2026-08-12 — Phase 2 database schema and seed data

### What was built

- Added six Prisma models, three domain enums, required relations, unique constraints, indexes, and migration-level numeric checks.
- Added an idempotent seed for Free/Pro plans, Free/Pro demo tenants, and a near-quota Free tenant.
- Added database-backed tests for plan limits, tenant assignments, rerun safety, and near-quota totals.

### AI assistance used

- Used AI to map the capstone data contract into Prisma relations and to design deterministic upsert-based fixtures and integration assertions.

### What AI got wrong

- Nothing recorded at implementation time; migration and seed verification determine whether schema assumptions hold.

### What was changed manually

- Pending maintainer review.

### Decisions made

- Pinned Pro at 50,000 API calls and 5,000,000 AI tokens per month.
- Used stable tenant and fixture IDs instead of making mutable display names unique.
- Represented 999 calls as one usage row with quantity 999; rollups meter quantities, not row counts.
- Used nullable unique Stripe identifiers, supported by PostgreSQL allowance of multiple nulls.
- Used BIGINT for integer micro-cent cost storage.

### Tests/evidence added

- Added src/tests/database-seed.test.ts; final command results are recorded after database verification.

---

## 2026-08-12 — Phase 2.5 Fastify migration

### What was built

- Replaced Express with Fastify while preserving the app factory/server entrypoint split.
- Added a real GET /health test using Fastify injection without a network port.
- Updated framework references across project documentation.

### AI assistance used

- Used AI to perform the dependency migration, adapt startup lifecycle code, and identify framework-specific documentation.

### What AI got wrong

- Nothing recorded after verification.

### What was changed manually

- Pending maintainer review.

### Decisions made

- Chose Fastify over Express before Phase 3 to make the backend more focused and to avoid React/Next.js style app structure.
- Kept logging disabled in the app factory for quiet deterministic tests; production logging can be configured later.
- Kept raw Stripe webhook handling documented as future route-scoped Fastify behavior and did not implement it.

### Tests/evidence added

- Replaced the placeholder health smoke test with a Fastify injection test.
- Re-ran the Phase 2 database seed integration tests unchanged.

---

## 2026-08-12 — Phase 3 transactional metering and idempotency

### What was built

- Added POST /generate as a dummy billable Fastify route.
- Added strict Zod request validation, canonical SHA-256 request hashing, tenant lookup, and layered metering/idempotency services.
- Added serializable Prisma transaction handling with bounded retry support for serialization and unique-key races.
- Stored one API_CALL and one AI_TOKENS event plus the original response for each new request.

### AI assistance used

- Used AI to design the route/service/repository split, transaction retry strategy, validation cases, and database-backed integration suite.

### What AI got wrong

- The first replay implementation returned semantically identical JSON whose property order differed after PostgreSQL JSONB storage.

### What was changed manually

- Reconstructed stored responses into the public response order, ensuring byte-identical fresh and replayed HTTP bodies.

### Decisions made

- Cost remains zero until Phase 5.
- Quotas remain unenforced until Phase 4.
- Canonical hashing uses a fixed validated field order and SHA-256.
- Transactions use serializable isolation and retry Prisma P2002/P2034 races up to three attempts.

### Tests/evidence added

- Added validation, metering quantity, exact replay, conflict, tenant scoping, and concurrent retry integration tests.
