# Delivery Phases

## Phase 1: Project setup and docs

**Goal:** Establish a reviewable, runnable foundation without domain logic. **Tasks:** package/TypeScript/Vitest config, Docker PostgreSQL, Prisma placeholder, layered folders, env/ignore files, required docs. **Gate:** dependencies install; typecheck, build, and smoke test pass; no secret or business implementation exists. **Evidence:** file tree and command output in setup/run proof.

## Phase 2: Database schema and seed data

**Goal:** Encode tenant, plan, subscription, usage, idempotency, and webhook identities. **Tasks:** implement reviewed Prisma models/enums/relations/indexes; migration; shared client; idempotent Free/Pro/demo/near-quota seed. Pin the Pro limits. **Gate:** clean database migrates and seed reruns without duplicates. **Evidence:** migration/status, seed output, representative database rows.

## Phase 2.5: Fastify framework migration

**Goal:** Standardize the backend HTTP layer on Fastify before domain routes begin. **Tasks:** replace the prior HTTP framework dependencies/code with Fastify, preserve the app/server split, expose a testable Fastify factory, and test GET /health through injection. **Gate:** typecheck, build, health injection test, and existing database seed tests pass; no domain endpoint is added. **Evidence:** dependency diff and verification output.
## Phase 3: Usage metering and idempotency

**Status:** Complete. **Goal:** Record each successful billable operation once under retries/concurrency. **Delivered:** strict token validation, tenant context, canonical SHA-256 request hashing, layered repository/service/route code, serializable transaction with bounded retries, exact response replay, 409 hash conflict, and two usage records per new request. **Gate:** validation, duplicate, conflict, tenant-scope, quantity, rollback, and concurrent retry tests pass. **Evidence:** Phase 3 integration suite and database assertions.

## Phase 4: Quota enforcement

**Status:** Complete. **Goal:** Prevent projected monthly usage above plan limits. **Delivered:** UTC month windows, quantity rollups for both usage types, plan-specific limits, inclusive exact-limit behavior, deterministic API-first 429 errors, and quota checks inside the serializable metering transaction. No 402 policy was added because payment-required behavior remains deferred. **Gate:** exact-limit passes; at/over-limit fails without usage or idempotency writes; concurrent boundary requests cannot both pass. **Evidence:** Phase 4 integration tests and full suite output.

## Phase 5: Cost calculation

**Status:** Complete. **Goal:** Produce deterministic integer costs per usage category. **Delivered:** pinned BigInt micro-cent rates, separate normal/cached/output/reasoning token pricing, output-rate reasoning, API-call pricing, per-category ceiling division, stored event costs, and stable response/replay cost summaries. **Gate:** exact hand-calculated fixtures, tiny-usage rounding, persistence, replay, quota, and full regression tests pass. **Evidence:** Phase 5 unit/integration tests and database assertions.

## Phase 6: Usage summary endpoint

**Status:** Complete. **Goal:** Answer monthly used/limit/cost questions per tenant. **Delivered:** tenant-scoped GET /usage, UTC inclusive/exclusive period boundaries, usage-type quantity and BigInt cost aggregation, actual plan/subscription projection, remaining quota, safe JSON money conversion, and historical-period exclusion. **Gate:** seeded Free/Pro/near-quota fixtures, custom aggregates, prior-month exclusion, and post-generate visibility tests pass. **Evidence:** Phase 6 integration and full regression suite output.

## Phase 7: Stripe Checkout

**Status:** Complete. **Goal:** Start a Pro upgrade through Stripe test mode. **Delivered:** lazy validated test-key configuration, injectable Stripe gateway, customer creation/persistence/reuse, subscription-mode Checkout with configured price and tenant metadata, safe success/cancel URLs, sanitized errors, and URL/session response. **Gate:** mocked Session creation passes and database assertions prove plan/status remain unchanged. **Evidence:** Phase 7 Checkout suite and full regression output.

## Phase 8: Stripe webhooks

**Goal:** Synchronize only verified events and tolerate duplicate delivery. **Tasks:** raw-body route ordering, signature verification, unique event claim, three required event handlers, transactional subscription/plan update. **Gate:** forged event has zero mutations; valid duplicate applies once; deletion/update behavior is correct. **Evidence:** Stripe CLI delivery, forged rejection, replay response, database state.

## Phase 9: Tests and evidence

**Goal:** Turn correctness claims into reproducible proof. **Tasks:** complete [TEST_PLAN.md](TEST_PLAN.md), coverage, clean-install run, fill evidence, review errors/secrets/tenant isolation. **Gate:** deterministic full suite passes from documented setup and every required evidence section is populated. **Evidence:** full logs and linked artifacts.

## Phase 10: Demo polish

**Goal:** Present a concise end-to-end portfolio demonstration. **Tasks:** verify README commands, scripted/manual demo flow, reset instructions, diagrams, limitations, final repository hygiene. **Gate:** a reviewer can seed, hit quota, prove replay safety, upgrade in Stripe, reject/replay webhooks, and inspect usage without undocumented steps. **Evidence:** dated end-to-end transcript or short recording and final checklist.




