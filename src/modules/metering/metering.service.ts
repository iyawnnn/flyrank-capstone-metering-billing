import {
  Prisma,
  PrismaClient,
  UsageType,
} from "@prisma/client";
import type {
  GenerateBody,
  GenerateResponse,
} from "../generate/generate.schemas.js";
import { findTenantById } from "../tenants/tenant.repository.js";
import { findIdempotencyRecord } from "./idempotency.service.js";
import { createRequestHash } from "./request-hash.js";
import { enforceMonthlyQuota } from "../quotas/quota.service.js";
import {
  calculateGenerationCost,
  toSafeMoneyNumber,
} from "../pricing/pricing.service.js";

export class TenantNotFoundError extends Error {
  constructor() {
    super("Tenant not found.");
    this.name = "TenantNotFoundError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("This idempotency key was already used with a different request body.");
    this.name = "IdempotencyConflictError";
  }
}

interface MeterUsageInput {
  tenantId: string;
  idempotencyKey: string;
  body: GenerateBody;
}

interface MeterUsageResult {
  status: number;
  response: GenerateResponse;
  replayed: boolean;
}

const TRANSACTION_RETRIES = 8;

const isRetryableTransactionError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2002" || error.code === "P2034");

const parseStoredResponse = (value: Prisma.JsonValue): GenerateResponse => {
  const stored = value as unknown as GenerateResponse;

  // PostgreSQL JSONB does not preserve object key order. Rebuild the public
  // response shape so fresh and replayed Fastify payloads serialize identically.
  return {
    tenantId: stored.tenantId,
    idempotencyKey: stored.idempotencyKey,
    simulated: true,
    usage: {
      apiCalls: 1,
      aiTokens: stored.usage.aiTokens,
    },
    cost: {
      apiCallMicroCents: stored.cost.apiCallMicroCents,
      aiTokensMicroCents: stored.cost.aiTokensMicroCents,
      totalMicroCents: stored.cost.totalMicroCents,
    },
    message: "Simulated generation completed.",
  };
};

export const meterGeneration = async (
  prisma: PrismaClient,
  input: MeterUsageInput,
): Promise<MeterUsageResult> => {
  const requestHash = createRequestHash(input.body);
  const aiTokens =
    input.body.inputTokens +
    input.body.cachedInputTokens +
    input.body.outputTokens +
    input.body.reasoningTokens;

  for (let attempt = 1; attempt <= TRANSACTION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          const existing = await findIdempotencyRecord(
            transaction,
            input.tenantId,
            input.idempotencyKey,
          );

          if (existing) {
            if (existing.requestHash !== requestHash) {
              throw new IdempotencyConflictError();
            }

            return {
              status: existing.responseStatus,
              response: parseStoredResponse(existing.responseBody),
              replayed: true,
            };
          }

          const tenant = await findTenantById(transaction, input.tenantId);
          if (!tenant) {
            throw new TenantNotFoundError();
          }

          await enforceMonthlyQuota(transaction, tenant, aiTokens);

          const cost = calculateGenerationCost(input.body);
          const response: GenerateResponse = {
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
            simulated: true,
            usage: {
              apiCalls: 1,
              aiTokens,
            },
            cost: {
              apiCallMicroCents: toSafeMoneyNumber(cost.apiCallMicroCents),
              aiTokensMicroCents: toSafeMoneyNumber(cost.aiTokensMicroCents),
              totalMicroCents: toSafeMoneyNumber(cost.totalMicroCents),
            },
            message: "Simulated generation completed.",
          };

          await transaction.usageEvent.createMany({
            data: [
              {
                tenantId: input.tenantId,
                usageType: UsageType.API_CALL,
                quantity: 1,
                idempotencyKey: input.idempotencyKey,
                requestHash,
                costMicroCents: cost.apiCallMicroCents,
                metadata: { phase: 5, simulated: true },
              },
              {
                tenantId: input.tenantId,
                usageType: UsageType.AI_TOKENS,
                quantity: aiTokens,
                idempotencyKey: input.idempotencyKey,
                requestHash,
                costMicroCents: cost.aiTokensMicroCents,
                metadata: {
                  phase: 5,
                  simulated: true,
                  tokenBreakdown: input.body,
                },
              },
            ],
          });

          await transaction.idempotencyKey.create({
            data: {
              tenantId: input.tenantId,
              key: input.idempotencyKey,
              requestHash,
              responseStatus: 200,
              responseBody: response as unknown as Prisma.InputJsonValue,
            },
          });

          return { status: 200, response, replayed: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < TRANSACTION_RETRIES) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Transaction retry limit reached.");
};







