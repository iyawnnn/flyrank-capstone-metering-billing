import "dotenv/config";
import {
  PlanName,
  PrismaClient,
  SubscriptionStatus,
  UsageType,
} from "@prisma/client";

export const SEEDED_IDS = {
  freeTenant: "tenant_demo_free",
  proTenant: "tenant_demo_pro",
  nearQuotaTenant: "tenant_near_quota_free",
  nearQuotaApiUsage: "usage_near_quota_api",
  nearQuotaTokenUsage: "usage_near_quota_tokens",
} as const;

export const PLAN_LIMITS = {
  FREE: { apiCalls: 1_000, aiTokens: 100_000 },
  PRO: { apiCalls: 50_000, aiTokens: 5_000_000 },
} as const;

const currentMonthFixtureDate = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 1));

export async function seedDatabase(
  prisma: PrismaClient,
  now = new Date(),
): Promise<void> {
  const freePlan = await prisma.plan.upsert({
    where: { name: PlanName.FREE },
    update: {
      monthlyApiCallLimit: PLAN_LIMITS.FREE.apiCalls,
      monthlyTokenLimit: PLAN_LIMITS.FREE.aiTokens,
      stripePriceId: null,
    },
    create: {
      name: PlanName.FREE,
      monthlyApiCallLimit: PLAN_LIMITS.FREE.apiCalls,
      monthlyTokenLimit: PLAN_LIMITS.FREE.aiTokens,
    },
  });

  const proPriceId =
    process.env.STRIPE_PRO_PRICE_ID || "price_test_pro_placeholder";
  const proPlan = await prisma.plan.upsert({
    where: { name: PlanName.PRO },
    update: {
      monthlyApiCallLimit: PLAN_LIMITS.PRO.apiCalls,
      monthlyTokenLimit: PLAN_LIMITS.PRO.aiTokens,
      stripePriceId: proPriceId,
    },
    create: {
      name: PlanName.PRO,
      monthlyApiCallLimit: PLAN_LIMITS.PRO.apiCalls,
      monthlyTokenLimit: PLAN_LIMITS.PRO.aiTokens,
      stripePriceId: proPriceId,
    },
  });

  await prisma.tenant.upsert({
    where: { id: SEEDED_IDS.freeTenant },
    update: {
      name: "Demo Free Tenant",
      planId: freePlan.id,
      subscriptionStatus: SubscriptionStatus.FREE,
    },
    create: {
      id: SEEDED_IDS.freeTenant,
      name: "Demo Free Tenant",
      planId: freePlan.id,
      subscriptionStatus: SubscriptionStatus.FREE,
    },
  });

  await prisma.tenant.upsert({
    where: { id: SEEDED_IDS.proTenant },
    update: {
      name: "Demo Pro Tenant",
      planId: proPlan.id,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    },
    create: {
      id: SEEDED_IDS.proTenant,
      name: "Demo Pro Tenant",
      planId: proPlan.id,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    },
  });

  await prisma.tenant.upsert({
    where: { id: SEEDED_IDS.nearQuotaTenant },
    update: {
      name: "Near-Quota Free Tenant",
      planId: freePlan.id,
      subscriptionStatus: SubscriptionStatus.FREE,
    },
    create: {
      id: SEEDED_IDS.nearQuotaTenant,
      name: "Near-Quota Free Tenant",
      planId: freePlan.id,
      subscriptionStatus: SubscriptionStatus.FREE,
    },
  });

  const fixtureDate = currentMonthFixtureDate(now);

  await prisma.usageEvent.upsert({
    where: { id: SEEDED_IDS.nearQuotaApiUsage },
    update: {
      tenantId: SEEDED_IDS.nearQuotaTenant,
      usageType: UsageType.API_CALL,
      quantity: 999,
      createdAt: fixtureDate,
    },
    create: {
      id: SEEDED_IDS.nearQuotaApiUsage,
      tenantId: SEEDED_IDS.nearQuotaTenant,
      usageType: UsageType.API_CALL,
      quantity: 999,
      idempotencyKey: "seed-near-quota-api",
      requestHash: "seed-fixture",
      costMicroCents: 0n,
      metadata: { source: "seed", purpose: "quota-boundary-testing" },
      createdAt: fixtureDate,
    },
  });

  await prisma.usageEvent.upsert({
    where: { id: SEEDED_IDS.nearQuotaTokenUsage },
    update: {
      tenantId: SEEDED_IDS.nearQuotaTenant,
      usageType: UsageType.AI_TOKENS,
      quantity: 50_000,
      createdAt: fixtureDate,
    },
    create: {
      id: SEEDED_IDS.nearQuotaTokenUsage,
      tenantId: SEEDED_IDS.nearQuotaTenant,
      usageType: UsageType.AI_TOKENS,
      quantity: 50_000,
      idempotencyKey: "seed-near-quota-tokens",
      requestHash: "seed-fixture",
      costMicroCents: 0n,
      metadata: { source: "seed", purpose: "quota-boundary-testing" },
      createdAt: fixtureDate,
    },
  });

  console.log("Seeded Free/Pro plans and three deterministic demo tenants.");
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
