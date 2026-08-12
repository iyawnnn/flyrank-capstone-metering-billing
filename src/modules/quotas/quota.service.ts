import type { Prisma, UsageType } from "@prisma/client";

interface TenantWithPlanLimits {
  id: string;
  plan: {
    monthlyApiCallLimit: number;
    monthlyTokenLimit: number;
  };
}

export interface QuotaDetails {
  usageType: UsageType;
  used: number;
  requested: number;
  limit: number;
  period: string;
}

export class QuotaExceededError extends Error {
  readonly quota: QuotaDetails;

  constructor(quota: QuotaDetails) {
    const label = quota.usageType === "API_CALL" ? "API call" : "AI token";
    super(label + " quota exceeded for the current month.");
    this.name = "QuotaExceededError";
    this.quota = quota;
  }
}

export interface UtcMonthWindow {
  start: Date;
  end: Date;
  period: string;
}

export const getUtcMonthWindow = (now = new Date()): UtcMonthWindow => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
    period: String(year) + "-" + String(month + 1).padStart(2, "0"),
  };
};

export const enforceMonthlyQuota = async (
  transaction: Prisma.TransactionClient,
  tenant: TenantWithPlanLimits,
  requestedAiTokens: number,
  now = new Date(),
): Promise<void> => {
  const window = getUtcMonthWindow(now);
  const usage = await transaction.usageEvent.groupBy({
    by: ["usageType"],
    where: {
      tenantId: tenant.id,
      createdAt: {
        gte: window.start,
        lt: window.end,
      },
    },
    _sum: { quantity: true },
  });

  const usedByType = new Map(
    usage.map((item) => [item.usageType, item._sum.quantity ?? 0]),
  );
  const apiCallsUsed = usedByType.get("API_CALL") ?? 0;
  const aiTokensUsed = usedByType.get("AI_TOKENS") ?? 0;

  // Deterministic precedence: API calls are checked before AI tokens.
  if (apiCallsUsed + 1 > tenant.plan.monthlyApiCallLimit) {
    throw new QuotaExceededError({
      usageType: "API_CALL",
      used: apiCallsUsed,
      requested: 1,
      limit: tenant.plan.monthlyApiCallLimit,
      period: window.period,
    });
  }

  if (aiTokensUsed + requestedAiTokens > tenant.plan.monthlyTokenLimit) {
    throw new QuotaExceededError({
      usageType: "AI_TOKENS",
      used: aiTokensUsed,
      requested: requestedAiTokens,
      limit: tenant.plan.monthlyTokenLimit,
      period: window.period,
    });
  }
};
