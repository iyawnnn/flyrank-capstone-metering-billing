import {
  PlanName,
  PrismaClient,
  SubscriptionStatus,
  UsageType,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../prisma/seed.js";
import { createApp } from "../app.js";
import { getUtcMonthWindow } from "../modules/quotas/quota.service.js";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/metering_billing?schema=public";

const prisma = new PrismaClient();
const testTenantId = "tenant_phase6_usage";
const keyPrefix = "phase6-test-";

const cleanup = async (): Promise<void> => {
  await prisma.tenant.deleteMany({ where: { id: testTenantId } });
};

const createTestTenant = async (): Promise<void> => {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { name: PlanName.FREE },
  });

  await prisma.tenant.create({
    data: {
      id: testTenantId,
      name: "Phase 6 Usage Test Tenant",
      planId: plan.id,
      subscriptionStatus: SubscriptionStatus.FREE,
    },
  });
};

const requestUsage = async (tenantId?: string) => {
  const app = createApp({ prisma });
  const headers =
    tenantId === undefined ? {} : { "x-tenant-id": tenantId };

  try {
    return await app.inject({
      method: "GET",
      url: "/usage",
      headers,
    });
  } finally {
    await app.close();
  }
};

const requestGenerate = async () => {
  const app = createApp({ prisma });

  try {
    return await app.inject({
      method: "POST",
      url: "/generate",
      headers: {
        "x-tenant-id": testTenantId,
        "idempotency-key": keyPrefix + "generate",
      },
      payload: {
        inputTokens: 1_000,
        cachedInputTokens: 200,
        outputTokens: 500,
        reasoningTokens: 100,
      },
    });
  } finally {
    await app.close();
  }
};

describe.sequential("GET /usage", () => {
  beforeAll(async () => {
    await seedDatabase(prisma);
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns 400 when x-tenant-id is missing", async () => {
    const response = await requestUsage();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "MISSING_TENANT_ID",
        message: "x-tenant-id header is required.",
      },
    });
  });

  it("returns 404 for an unknown tenant", async () => {
    const response = await requestUsage("tenant_does_not_exist");

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("TENANT_NOT_FOUND");
  });

  it("returns the seeded Free tenant and Free limits", async () => {
    const response = await requestUsage("tenant_demo_free");
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      tenant: { id: "tenant_demo_free", name: "Demo Free Tenant" },
      plan: {
        name: "FREE",
        monthlyApiCallLimit: 1_000,
        monthlyTokenLimit: 100_000,
      },
      subscriptionStatus: "FREE",
    });
  });

  it("returns the seeded Pro tenant and Pro limits", async () => {
    const response = await requestUsage("tenant_demo_pro");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tenant: { id: "tenant_demo_pro", name: "Demo Pro Tenant" },
      plan: {
        name: "PRO",
        monthlyApiCallLimit: 50_000,
        monthlyTokenLimit: 5_000_000,
      },
      subscriptionStatus: "ACTIVE",
    });
  });

  it("returns near-quota seed totals, remaining quota, and UTC boundaries", async () => {
    const response = await requestUsage("tenant_near_quota_free");
    const body = response.json();
    const window = getUtcMonthWindow();

    expect(response.statusCode).toBe(200);
    expect(body.period).toEqual({
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    });
    expect(body.usage).toEqual({
      apiCalls: {
        used: 999,
        limit: 1_000,
        remaining: 1,
        costMicroCents: 0,
      },
      aiTokens: {
        used: 50_000,
        limit: 100_000,
        remaining: 50_000,
        costMicroCents: 0,
      },
    });
    expect(body.cost).toEqual({
      apiCallMicroCents: 0,
      aiTokensMicroCents: 0,
      totalMicroCents: 0,
    });
  });

  it("aggregates current quantities and costs while excluding prior-month usage", async () => {
    await createTestTenant();
    const window = getUtcMonthWindow();
    const previousMonth = new Date(window.start.getTime() - 1);

    await prisma.usageEvent.createMany({
      data: [
        {
          tenantId: testTenantId,
          usageType: UsageType.API_CALL,
          quantity: 7,
          idempotencyKey: keyPrefix + "current-api",
          requestHash: "fixture",
          costMicroCents: 70n,
          createdAt: window.start,
        },
        {
          tenantId: testTenantId,
          usageType: UsageType.AI_TOKENS,
          quantity: 123,
          idempotencyKey: keyPrefix + "current-tokens",
          requestHash: "fixture",
          costMicroCents: 45n,
          createdAt: window.start,
        },
        {
          tenantId: testTenantId,
          usageType: UsageType.API_CALL,
          quantity: 900,
          idempotencyKey: keyPrefix + "previous-api",
          requestHash: "fixture",
          costMicroCents: 9_000n,
          createdAt: previousMonth,
        },
        {
          tenantId: testTenantId,
          usageType: UsageType.AI_TOKENS,
          quantity: 90_000,
          idempotencyKey: keyPrefix + "previous-tokens",
          requestHash: "fixture",
          costMicroCents: 90_000n,
          createdAt: previousMonth,
        },
      ],
    });

    const response = await requestUsage(testTenantId);
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.usage.apiCalls).toEqual({
      used: 7,
      limit: 1_000,
      remaining: 993,
      costMicroCents: 70,
    });
    expect(body.usage.aiTokens).toEqual({
      used: 123,
      limit: 100_000,
      remaining: 99_877,
      costMicroCents: 45,
    });
    expect(body.cost).toEqual({
      apiCallMicroCents: 70,
      aiTokensMicroCents: 45,
      totalMicroCents: 115,
    });
  });

  it("reflects usage and exact costs after POST /generate", async () => {
    await createTestTenant();

    const generateResponse = await requestGenerate();
    const usageResponse = await requestUsage(testTenantId);
    const body = usageResponse.json();

    expect(generateResponse.statusCode).toBe(200);
    expect(usageResponse.statusCode).toBe(200);
    expect(body.usage.apiCalls).toMatchObject({
      used: 1,
      costMicroCents: 10,
    });
    expect(body.usage.aiTokens).toMatchObject({
      used: 1_800,
      costMicroCents: 405,
    });
    expect(body.cost).toEqual({
      apiCallMicroCents: 10,
      aiTokensMicroCents: 405,
      totalMicroCents: 415,
    });
  });
});
