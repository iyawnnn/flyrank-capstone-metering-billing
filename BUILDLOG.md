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

---

## 2026-08-12 — Phase 4 monthly quota enforcement

### What was built

- Added UTC calendar-month usage aggregation and plan-limit enforcement for API_CALL and AI_TOKENS.
- Integrated quota evaluation before writes inside the existing serializable Prisma transaction.
- Added structured 429 responses and comprehensive boundary/concurrency integration tests.

### AI assistance used

- Used AI to design the UTC window helper, deterministic error precedence, transaction placement, and isolated database fixtures.

### What AI got wrong

- Nothing recorded after focused verification.

### What was changed manually

- Pending maintainer review.

### Decisions made

- Exactly reaching a limit succeeds; only projected usage greater than the limit fails.
- API_CALL is checked before AI_TOKENS when both would exceed.
- Existing successful idempotency records are replayed before a new quota check.
- Quota rejection is not persisted as a successful idempotency response.
- No 402 behavior was introduced because payment-required policy is outside Phase 4.

### Tests/evidence added

- Added eight integration scenarios covering API/token boundaries, rejection atomicity, error details, Pro limits, replay behavior, and concurrent last-slot safety.

---

## 2026-08-12 — Phase 5 deterministic integer pricing

### What was built

- Added pinned BigInt pricing configuration and pure pricing services.
- Added separate category pricing with ceiling division per category.
- Replaced zero placeholder costs with exact API and AI-token UsageEvent costs.
- Added a stable cost summary to new and replayed POST /generate responses.

### AI assistance used

- Used AI to derive integer-safe formulas, integrate BigInt persistence with JSON-safe responses, and build exact pricing fixtures.

### What AI got wrong

- The first mechanical edit did not replace the two zero-cost lines because their newline formatting differed.

### What was changed manually

- Corrected the two UsageEvent assignments and normalized their formatting before verification.

### Decisions made

- Money is computed and persisted as bigint micro-cents.
- Each token category is multiplied by its own per-million rate and ceiling-divided independently.
- Reasoning uses the output rate.
- HTTP cost values are converted to numbers only after a safe-integer assertion.

### Tests/evidence added

- Added eight pure pricing tests and updated generate integration assertions for stored and returned costs.

---

## 2026-08-12 — Phase 6 tenant usage rollup

### What was built

- Added tenant-scoped GET /usage with a thin Fastify route and usage aggregation service.
- Added tenant/plan/subscription projection, UTC period boundaries, per-type quantities and costs, remaining quota, and total cost.
- Added current-period filtering and historical usage exclusion.

### AI assistance used

- Used AI to design the response type, grouped Prisma query, safe BigInt conversion boundary, and isolated integration fixtures.

### What AI got wrong

- Nothing recorded after focused verification.

### What was changed manually

- Pending maintainer review.

### Decisions made

- Reused the quota service UTC calendar-month helper to keep write and read periods identical.
- Kept database costs as bigint and returned JSON numbers only through the existing safe-integer guard.
- Clamped remaining quota at zero for defensive reporting if imported or historical data exceeds a limit.
- Used one grouped query for quantity and cost totals by usage type.

### Tests/evidence added

- Added seven integration scenarios covering errors, seeded plans/totals, periods, aggregation, old-event exclusion, and post-generate visibility.

---

## 2026-08-12 — Phase 7 Stripe test-mode Checkout

### What was built

- Added POST /billing/checkout with a thin Fastify route and Checkout service.
- Added lazy Stripe test-mode configuration validation and an injectable SDK adapter.
- Added Stripe customer creation/persistence/reuse and subscription Session creation.
- Added sanitized configuration and upstream error responses.

### AI assistance used

- Used AI to design the injectable Stripe boundary, environment validation, customer lifecycle, Session arguments, and mocked integration suite.

### What AI got wrong

- Nothing recorded after focused verification.

### What was changed manually

- Pending maintainer review.

### Decisions made

- Stripe is initialized lazily so non-billing routes work without Stripe configuration.
- Only sk_test_ secrets are accepted.
- Missing configuration returns 503 and sanitized Stripe failures return 502.
- Checkout stores only stripeCustomerId; it never updates planId or subscriptionStatus.
- Both Session metadata and subscription_data.metadata carry tenantId for Phase 8 correlation.

### Tests/evidence added

- Added seven mocked integration scenarios covering errors, customer lifecycle, Session construction, response fields, and no premature upgrade.

---

## 2026-08-12 — Phase 8 verified and deduplicated Stripe webhooks

### What was built

- Added POST /webhooks/stripe with route-specific raw-body preservation and Stripe SDK signature verification.
- Added transactional StripeEvent claiming, duplicate responses, and processed timestamps.
- Added checkout completion, subscription update, and subscription deletion projections.
- Added tenant fallback resolution and deterministic subscription status mapping.

### AI assistance used

- Used AI to design raw-body routing, injectable verification, transaction/duplicate handling, status mapping, fallback resolution, and integration fixtures.

### What AI got wrong

- The first targeted app edit did not match existing whitespace, so the app factory was rewritten cleanly with equivalent prior route registrations.
- The first full parallel regression run exposed the earlier three-attempt metering transaction retry bound under added database contention; it was increased to eight and the full suite passed.

### What was changed manually

- Preserved all existing app dependencies/routes while adding the custom parser and webhook registration.

### Decisions made

- Only /webhooks/stripe receives raw bytes; other application/json routes retain normal parsing.
- Event claim and all projections share one serializable transaction.
- Duplicate IDs return 200 without another update.
- active/trialing and past_due remain Pro; canceled/unpaid/incomplete states downgrade to Free.
- Permanent verified payload resolution failures return controlled 422 and roll back the claim.

### Tests/evidence added

- Added thirteen route/database scenarios for signatures, raw bytes, projections, fallbacks, duplicates, ignored events, and rollback.


---

## 2026-08-12 — Phase 9 evidence, hardening, and demo verification

### What was reviewed

- Audited README.md, capstone.yaml, EVIDENCE.md, BUILDLOG.md, .env.example, .gitignore, commands, endpoint inventory, and implemented behavior.
- Reviewed raw webhook verification, sanitized Stripe errors, tenant-scoped reads/writes, generated artifacts, dependency audit, and credential-shaped patterns.
- Confirmed the Prisma schema required no Phase 9 change or migration.

### What evidence was added

- Consolidated metering, idempotency, quota, pricing, usage, Checkout, webhook signature, duplicate event, database/seed, test, coverage, setup, and secret-hygiene proof.
- Recorded 8 passing test files, 60 passing tests, and aggregate coverage of 86.06% statements, 82.80% branches, 89.70% functions, and 86.06% lines.
- Recorded successful typecheck, build, Prisma generation/validation/migration status, seed rerun, and npm audit with zero vulnerabilities.

### Manual checks prepared

- Added MANUAL_TESTING.md with exact local database/API startup, health, generate/retry/conflict, quota, usage, Checkout, Stripe CLI forwarding, event resend, forgery, verification, and reset steps.
- Marked real Stripe CLI and hosted Checkout artifacts as manual because credentials are intentionally absent.

### AI assistance used

- Used AI to audit documentation against implementation, consolidate evidence, design reproducible redacted demo commands, interpret coverage, and run secret/ignore checks.

### What AI got wrong

- The first detached compiled-server health probe did not become reachable in the managed Windows process harness; the seed succeeded, build passed, and route health remains proven through Fastify injection. This limitation is recorded instead of overstating runtime evidence.
- The first MANUAL_TESTING.md write used PowerShell continuation characters that conflicted with the orchestration script; it was rewritten with portable single-line curl commands.

### What was corrected manually

- Removed the unimplemented POST /seed probe from capstone.yaml and documented npm run db:seed as the supported seed interface.
- Removed stale README statements that claimed only /health existed or that pricing/quota/webhooks were future work.
- Reorganized README into one coherent setup, API, security, Stripe, demo, and limitation guide.

### Decisions and limitations

- No production feature, schema, migration, or deployment work was added.
- Coverage is documented rather than forced to 100%; process startup, real Stripe network adapters, and types/config placeholders are the principal gaps.
- Real Stripe CLI proof must be added manually with test-mode credentials and redaction.
- x-tenant-id remains capstone tenant context, not production authentication.

### Tests/evidence added

- No new business behavior tests were necessary.
- Re-ran the complete suite and V8 coverage plus all required build, Prisma, migration, audit, seed, ignore, and credential scans.

---

## 2026-08-12 — Phase 9 repository cleanup and consistency hardening

### What was reviewed

- Rechecked package.json/package-lock.json against runtime imports, test imports, and npm scripts.
- Reviewed all planning, architecture, API, schema, test, evidence, submission, environment, and manual-demo documents against implemented behavior.
- Rechecked tracked and ignored artifacts, credential-shaped patterns, Stripe error responses, and endpoint inventory.

### Stale content corrected

- Removed the nonexistent POST /seed contract from API_SPEC.md; npm run db:seed remains the supported interface.
- Removed future-tense webhook wording and the obsolete optional 402 statement.
- Updated architecture concurrency language to describe the implemented serializable transaction and bounded retries.
- Updated Subscription documentation to describe implemented verified-event synchronization.
- Standardized outstanding real Stripe evidence as: TODO: paste manual Stripe CLI transcript after local demo run.
- Removed unused Phase 1 middleware/config stubs and obsolete .gitkeep files.

### Dependencies checked

- Confirmed every direct runtime dependency is imported: Fastify, Prisma Client, dotenv, Stripe, and Zod.
- Confirmed every development dependency supports a script, compiler, generated client, coverage, or test workflow.
- Confirmed Express is absent and Fastify is the only HTTP framework.
- No dependency was removed because none was unused.

### Security checks run

- Verified .env, node_modules, dist, coverage, logs, and local database files are ignored.
- Scanned repository content for credential-shaped Stripe test/live keys and real webhook secrets.
- Reviewed Stripe route errors for sanitization and confirmed no raw SDK exception is returned.
- Confirmed generated artifacts are ignored and no real .env exists.

### Remaining manual testing/demo work

- Run a real Stripe test-mode Checkout.
- Capture a redacted signed Stripe CLI webhook delivery.
- Resend the exact event and capture duplicate true.
- Capture post-webhook Pro/ACTIVE usage state.
- Capture npm run dev plus GET /health from the final demo environment.

### Final command verification note

- Typecheck, build, all 60 tests, and coverage passed after placeholder removal.
- The first Prisma generation attempt encountered a Windows EPERM rename because a prior workspace server probe still held the generated query-engine DLL.
- The identified process was specifically node dist/src/server.js from this workspace; after stopping it, Prisma generation, schema validation, migration status, npm audit, Express absence, and Fastify presence all passed.
