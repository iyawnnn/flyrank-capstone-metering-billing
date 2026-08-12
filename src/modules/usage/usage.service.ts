import type { PrismaClient } from "@prisma/client";
import { getUtcMonthWindow } from "../quotas/quota.service.js";
import { toSafeMoneyNumber } from "../pricing/pricing.service.js";
import { findTenantUsageProfile } from "../tenants/tenant.repository.js";
import type { UsageSummary } from "./usage.types.js";

export class UsageTenantNotFoundError extends Error {
  constructor() {
    super("Tenant not found.");
    this.name = "UsageTenantNotFoundError";
  }
}

export const getCurrentMonthUsage = async (
  prisma: PrismaClient,
  tenantId: string,
  now = new Date(),
): Promise<UsageSummary> => {
  const tenant = await findTenantUsageProfile(prisma, tenantId);
  if (!tenant) {
    throw new UsageTenantNotFoundError();
  }

  const window = getUtcMonthWindow(now);
  const aggregates = await prisma.usageEvent.groupBy({
    by: ["usageType"],
    where: {
      tenantId,
      createdAt: {
        gte: window.start,
        lt: window.end,
      },
    },
    _sum: {
      quantity: true,
      costMicroCents: true,
    },
  });

  const apiAggregate = aggregates.find(
    (aggregate) => aggregate.usageType === "API_CALL",
  );
  const tokenAggregate = aggregates.find(
    (aggregate) => aggregate.usageType === "AI_TOKENS",
  );

  const apiCallsUsed = apiAggregate?._sum.quantity ?? 0;
  const aiTokensUsed = tokenAggregate?._sum.quantity ?? 0;
  const apiCallCost = apiAggregate?._sum.costMicroCents ?? 0n;
  const aiTokenCost = tokenAggregate?._sum.costMicroCents ?? 0n;
  const apiCallCostNumber = toSafeMoneyNumber(apiCallCost);
  const aiTokenCostNumber = toSafeMoneyNumber(aiTokenCost);

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
    },
    plan: {
      name: tenant.plan.name,
      monthlyApiCallLimit: tenant.plan.monthlyApiCallLimit,
      monthlyTokenLimit: tenant.plan.monthlyTokenLimit,
    },
    subscriptionStatus: tenant.subscriptionStatus,
    period: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    },
    usage: {
      apiCalls: {
        used: apiCallsUsed,
        limit: tenant.plan.monthlyApiCallLimit,
        remaining: Math.max(
          tenant.plan.monthlyApiCallLimit - apiCallsUsed,
          0,
        ),
        costMicroCents: apiCallCostNumber,
      },
      aiTokens: {
        used: aiTokensUsed,
        limit: tenant.plan.monthlyTokenLimit,
        remaining: Math.max(
          tenant.plan.monthlyTokenLimit - aiTokensUsed,
          0,
        ),
        costMicroCents: aiTokenCostNumber,
      },
    },
    cost: {
      apiCallMicroCents: apiCallCostNumber,
      aiTokensMicroCents: aiTokenCostNumber,
      totalMicroCents: toSafeMoneyNumber(apiCallCost + aiTokenCost),
    },
  };
};
