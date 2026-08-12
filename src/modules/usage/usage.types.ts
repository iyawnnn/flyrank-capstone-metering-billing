import type { PlanName, SubscriptionStatus } from "@prisma/client";

export interface UsageSummary {
  tenant: {
    id: string;
    name: string;
  };
  plan: {
    name: PlanName;
    monthlyApiCallLimit: number;
    monthlyTokenLimit: number;
  };
  subscriptionStatus: SubscriptionStatus;
  period: {
    start: string;
    end: string;
  };
  usage: {
    apiCalls: {
      used: number;
      limit: number;
      remaining: number;
      costMicroCents: number;
    };
    aiTokens: {
      used: number;
      limit: number;
      remaining: number;
      costMicroCents: number;
    };
  };
  cost: {
    apiCallMicroCents: number;
    aiTokensMicroCents: number;
    totalMicroCents: number;
  };
}
