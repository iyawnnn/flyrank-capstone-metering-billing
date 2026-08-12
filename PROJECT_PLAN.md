# Project Plan

## Goal

Build a portfolio-ready backend that answers how much a tenant used this month, what it costs, whether the plan limit is reached, and whether Stripe can safely upgrade and synchronize the subscription.

## Problem

Billing infrastructure must remain correct under network retries, simultaneous quota checks, duplicated webhook delivery, and subscription changes. A plausible happy path is insufficient: every accepted billable action must be attributable once, tenant-isolated, priced deterministically, and constrained by its plan.

## Why correctness matters

Double-counting erodes customer trust; under-counting loses revenue; stale plan state grants or blocks service incorrectly; forged webhooks create an authorization boundary failure. This capstone treats database constraints, transactions, signature verification, integer money, and boundary tests as product behavior.

## Core MVP scope

- Free and Pro plans
- API-call and categorized AI-token metering
- Tenant-scoped idempotent `POST /generate`
- Exact monthly quota enforcement
- Integer cost calculation in micro-cents
- Monthly `GET /usage` rollup
- Stripe test-mode Pro Checkout
- Verified, deduplicated subscription webhooks
- PostgreSQL, Prisma, structured JSON errors, tests, and evidence

## Non-goals

Frontend UI, real model calls, real payments, invoices, proration, overages, notifications, admin tooling, multiple paid products, and production deployment.

## Modules

- `tenants`: tenant lookup and isolation
- `plans`: limits and plan identity
- `metering`: atomic usage recording and idempotency
- `quotas`: monthly boundary decisions
- `pricing`: pinned integer price calculations
- `usage`: monthly aggregation
- `billing`: Stripe customer and Checkout orchestration
- `webhooks`: verification, deduplication, and subscription projection

HTTP controllers remain thin; services own business rules; repositories own queries; config owns environment and prices.

## Delivery approach

Ship the ten phases in [PHASES.md](PHASES.md). Each phase ends at a testable checkpoint and adds evidence before later behavior expands the system.

## Stretch goals after core ships

- Concurrency stress tests for quota/idempotency transactions
- OpenAPI generation from Zod schemas
- Structured request logging and correlation IDs
- CI checks for typecheck, tests, and migration validation

None should delay the core capstone.

## Resume value

The finished project demonstrates multi-tenant data modeling, transactional/idempotent APIs, exact quota boundaries, deterministic pricing, secure Stripe integration, webhook replay safety, and evidence-led backend testing.


## HTTP framework

Fastify is the HTTP framework. The app factory is independent from the listening server, allowing route tests through Fastify injection without opening network ports.
