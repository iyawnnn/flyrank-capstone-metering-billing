import { PlanName, PrismaClient, UsageType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAN_LIMITS, SEEDED_IDS, seedDatabase } from "../../prisma/seed.js";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/metering_billing?schema=public";

const prisma = new PrismaClient();

describe.sequential("Phase 2 database seed", () => {
  beforeAll(async () => {
    await seedDatabase(prisma, new Date("2026-08-12T00:00:00.000Z"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates the Free and Pro plans with pinned limits", async () => {
    const plans = await prisma.plan.findMany({
      where: { name: { in: [PlanName.FREE, PlanName.PRO] } },
      orderBy: { name: "asc" },
    });

    expect(plans).toHaveLength(2);
    expect(plans.find((plan) => plan.name === PlanName.FREE)).toMatchObject({
      monthlyApiCallLimit: PLAN_LIMITS.FREE.apiCalls,
      monthlyTokenLimit: PLAN_LIMITS.FREE.aiTokens,
    });
    expect(plans.find((plan) => plan.name === PlanName.PRO)).toMatchObject({
      monthlyApiCallLimit: PLAN_LIMITS.PRO.apiCalls,
      monthlyTokenLimit: PLAN_LIMITS.PRO.aiTokens,
    });
  });

  it("creates the three demo tenants on their intended plans", async () => {
    const tenants = await prisma.tenant.findMany({
      where: {
        id: {
          in: [
            SEEDED_IDS.freeTenant,
            SEEDED_IDS.proTenant,
            SEEDED_IDS.nearQuotaTenant,
          ],
        },
      },
      include: { plan: true },
    });

    expect(tenants).toHaveLength(3);
    expect(
      tenants.find((tenant) => tenant.id === SEEDED_IDS.freeTenant)?.plan.name,
    ).toBe(PlanName.FREE);
    expect(
      tenants.find((tenant) => tenant.id === SEEDED_IDS.proTenant)?.plan.name,
    ).toBe(PlanName.PRO);
    expect(
      tenants.find((tenant) => tenant.id === SEEDED_IDS.nearQuotaTenant)?.plan
        .name,
    ).toBe(PlanName.FREE);
  });

  it("can rerun without duplicating plans, tenants, or fixtures", async () => {
    await seedDatabase(prisma, new Date("2026-08-12T00:00:00.000Z"));

    const [planCount, tenantCount, fixtureCount] = await Promise.all([
      prisma.plan.count({
        where: { name: { in: [PlanName.FREE, PlanName.PRO] } },
      }),
      prisma.tenant.count({
        where: {
          id: {
            in: [
              SEEDED_IDS.freeTenant,
              SEEDED_IDS.proTenant,
              SEEDED_IDS.nearQuotaTenant,
            ],
          },
        },
      }),
      prisma.usageEvent.count({
        where: {
          id: {
            in: [
              SEEDED_IDS.nearQuotaApiUsage,
              SEEDED_IDS.nearQuotaTokenUsage,
            ],
          },
        },
      }),
    ]);

    expect({ planCount, tenantCount, fixtureCount }).toEqual({
      planCount: 2,
      tenantCount: 3,
      fixtureCount: 2,
    });
  });

  it("seeds 999 current-month API calls and sub-limit token usage", async () => {
    const [apiUsage, tokenUsage] = await Promise.all([
      prisma.usageEvent.aggregate({
        where: {
          tenantId: SEEDED_IDS.nearQuotaTenant,
          usageType: UsageType.API_CALL,
          createdAt: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
        _sum: { quantity: true },
      }),
      prisma.usageEvent.aggregate({
        where: {
          tenantId: SEEDED_IDS.nearQuotaTenant,
          usageType: UsageType.AI_TOKENS,
          createdAt: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
        _sum: { quantity: true },
      }),
    ]);

    expect(apiUsage._sum.quantity).toBe(999);
    expect(tokenUsage._sum.quantity).toBe(50_000);
    expect(tokenUsage._sum.quantity).toBeLessThan(
      PLAN_LIMITS.FREE.aiTokens,
    );
  });
});
