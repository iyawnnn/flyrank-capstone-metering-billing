import {
  PlanName,
  PrismaClient,
  SubscriptionStatus,
  UsageType,
} from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { getUtcMonthWindow } from "../modules/quotas/quota.service.js";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/metering_billing?schema=public";

const prisma = new PrismaClient();
const tenantId = "tenant_phase4_quota";
const secondTenantId = "tenant_phase4_quota_concurrent";
const keyPrefix = "phase4-test-";
const oneTokenBody = {
  inputTokens: 1,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

const createTenant = async (
  id: string,
  planName: PlanName = PlanName.FREE,
): Promise<void> => {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { name: planName },
  });

  await prisma.tenant.create({
    data: {
      id,
      name: "Phase 4 Quota Test Tenant",
      planId: plan.id,
      subscriptionStatus:
        planName === PlanName.PRO
          ? SubscriptionStatus.ACTIVE
          : SubscriptionStatus.FREE,
    },
  });
};

const cleanup = async (): Promise<void> => {
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantId, secondTenantId] } },
  });
};

const seedUsage = async (
  targetTenantId: string,
  usageType: UsageType,
  quantity: number,
  suffix: string,
): Promise<void> => {
  await prisma.usageEvent.create({
    data: {
      tenantId: targetTenantId,
      usageType,
      quantity,
      idempotencyKey: keyPrefix + "fixture-" + suffix,
      requestHash: "phase4-fixture",
      costMicroCents: 0n,
      createdAt: getUtcMonthWindow().start,
      metadata: { phase: 4, fixture: true },
    },
  });
};

const generate = async (
  targetTenantId: string,
  key: string,
  body = oneTokenBody,
) => {
  const app = createApp({ prisma });

  try {
    return await app.inject({
      method: "POST",
      url: "/generate",
      headers: {
        "x-tenant-id": targetTenantId,
        "idempotency-key": key,
      },
      payload: body,
    });
  } finally {
    await app.close();
  }
};

const requestWriteCounts = async (key: string) => ({
  usageEvents: await prisma.usageEvent.count({
    where: { idempotencyKey: key },
  }),
  idempotencyKeys: await prisma.idempotencyKey.count({
    where: { key },
  }),
});

describe.sequential("POST /generate monthly quotas", () => {
  beforeEach(async () => {
    await cleanup();
    await createTenant(tenantId);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("allows a request that reaches the API call limit exactly", async () => {
    await seedUsage(tenantId, UsageType.API_CALL, 999, "api-just-under");
    const key = keyPrefix + "api-exact-limit";

    const response = await generate(tenantId, key);

    expect(response.statusCode).toBe(200);
    const total = await prisma.usageEvent.aggregate({
      where: {
        tenantId,
        usageType: UsageType.API_CALL,
        createdAt: {
          gte: getUtcMonthWindow().start,
          lt: getUtcMonthWindow().end,
        },
      },
      _sum: { quantity: true },
    });
    expect(total._sum.quantity).toBe(1_000);
  });

  it("rejects another request when API usage is exactly at its limit", async () => {
    await seedUsage(tenantId, UsageType.API_CALL, 1_000, "api-at-limit");
    const key = keyPrefix + "api-at-limit";

    const response = await generate(tenantId, key);
    const body = response.json();

    expect(response.statusCode).toBe(429);
    expect(body).toMatchObject({
      error: "quota_exceeded",
      message: "API call quota exceeded for the current month.",
      quota: {
        usageType: "API_CALL",
        used: 1_000,
        requested: 1,
        limit: 1_000,
        period: getUtcMonthWindow().period,
      },
    });
    expect(await requestWriteCounts(key)).toEqual({
      usageEvents: 0,
      idempotencyKeys: 0,
    });
  });

  it("rejects a tenant already over API quota and checks API first", async () => {
    await seedUsage(tenantId, UsageType.API_CALL, 1_001, "api-over");
    await seedUsage(tenantId, UsageType.AI_TOKENS, 100_000, "tokens-also-full");
    const key = keyPrefix + "api-over";

    const response = await generate(tenantId, key);

    expect(response.statusCode).toBe(429);
    expect(response.json().quota.usageType).toBe("API_CALL");
    expect(await requestWriteCounts(key)).toEqual({
      usageEvents: 0,
      idempotencyKeys: 0,
    });
  });

  it("allows a request that reaches the AI token limit exactly", async () => {
    await seedUsage(
      tenantId,
      UsageType.AI_TOKENS,
      99_999,
      "tokens-just-under",
    );
    const key = keyPrefix + "tokens-exact-limit";

    const response = await generate(tenantId, key);

    expect(response.statusCode).toBe(200);
    const total = await prisma.usageEvent.aggregate({
      where: {
        tenantId,
        usageType: UsageType.AI_TOKENS,
        createdAt: {
          gte: getUtcMonthWindow().start,
          lt: getUtcMonthWindow().end,
        },
      },
      _sum: { quantity: true },
    });
    expect(total._sum.quantity).toBe(100_000);
  });

  it("rejects another token when AI token usage is at its limit", async () => {
    await seedUsage(tenantId, UsageType.AI_TOKENS, 100_000, "tokens-at-limit");
    const key = keyPrefix + "tokens-at-limit";

    const response = await generate(tenantId, key);
    const body = response.json();

    expect(response.statusCode).toBe(429);
    expect(body.quota).toEqual({
      usageType: "AI_TOKENS",
      used: 100_000,
      requested: 1,
      limit: 100_000,
      period: getUtcMonthWindow().period,
    });
    expect(await requestWriteCounts(key)).toEqual({
      usageEvents: 0,
      idempotencyKeys: 0,
    });
  });

  it("uses Pro plan limits instead of Free limits", async () => {
    await cleanup();
    await createTenant(tenantId, PlanName.PRO);
    await seedUsage(tenantId, UsageType.API_CALL, 1_000, "pro-api");
    await seedUsage(tenantId, UsageType.AI_TOKENS, 100_000, "pro-tokens");
    const key = keyPrefix + "pro-limits";

    const response = await generate(tenantId, key);

    expect(response.statusCode).toBe(200);
    expect(await requestWriteCounts(key)).toEqual({
      usageEvents: 2,
      idempotencyKeys: 1,
    });
  });

  it("preserves a successful replay even after usage reaches the limit", async () => {
    await seedUsage(tenantId, UsageType.API_CALL, 999, "replay-boundary");
    const key = keyPrefix + "replay-at-limit";

    const first = await generate(tenantId, key);
    const replay = await generate(tenantId, key);

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe(first.body);
    expect(await requestWriteCounts(key)).toEqual({
      usageEvents: 2,
      idempotencyKeys: 1,
    });
  });

  it("serializes concurrent boundary requests so only one reaches the limit", async () => {
    await cleanup();
    await createTenant(secondTenantId);
    await seedUsage(
      secondTenantId,
      UsageType.API_CALL,
      999,
      "concurrent-boundary",
    );

    const responses = await Promise.all([
      generate(secondTenantId, keyPrefix + "concurrent-a"),
      generate(secondTenantId, keyPrefix + "concurrent-b"),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200,
      429,
    ]);

    const successfulWrites = await prisma.usageEvent.count({
      where: {
        tenantId: secondTenantId,
        idempotencyKey: { startsWith: keyPrefix + "concurrent-" },
      },
    });
    const successfulKeys = await prisma.idempotencyKey.count({
      where: {
        tenantId: secondTenantId,
        key: { startsWith: keyPrefix + "concurrent-" },
      },
    });

    expect(successfulWrites).toBe(2);
    expect(successfulKeys).toBe(1);
  });
});
