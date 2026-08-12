import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { generateBodySchema } from "./generate.schemas.js";
import {
  IdempotencyConflictError,
  meterGeneration,
  TenantNotFoundError,
} from "../metering/metering.service.js";
import { QuotaExceededError } from "../quotas/quota.service.js";

const readRequiredHeader = (
  request: FastifyRequest,
  name: "x-tenant-id" | "idempotency-key",
): string | undefined => {
  const value = request.headers[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const errorBody = (code: string, message: string, details?: unknown) => ({
  error: {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  },
});

export const registerGenerateRoutes = (
  app: FastifyInstance,
  prisma: PrismaClient,
): void => {
  app.post("/generate", async (request, reply) => {
    const tenantId = readRequiredHeader(request, "x-tenant-id");
    if (!tenantId) {
      return reply
        .code(400)
        .send(errorBody("MISSING_TENANT_ID", "x-tenant-id header is required."));
    }

    const idempotencyKey = readRequiredHeader(request, "idempotency-key");
    if (!idempotencyKey) {
      return reply
        .code(400)
        .send(
          errorBody(
            "MISSING_IDEMPOTENCY_KEY",
            "idempotency-key header is required.",
          ),
        );
    }

    try {
      const body = generateBodySchema.parse(request.body);
      const result = await meterGeneration(prisma, {
        tenantId,
        idempotencyKey,
        body,
      });

      return reply.code(result.status).send(result.response);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply
          .code(400)
          .send(
            errorBody(
              "INVALID_REQUEST_BODY",
              "Request body validation failed.",
              error.issues,
            ),
          );
      }

      if (error instanceof TenantNotFoundError) {
        return reply
          .code(404)
          .send(errorBody("TENANT_NOT_FOUND", error.message));
      }

      if (error instanceof IdempotencyConflictError) {
        return reply
          .code(409)
          .send(errorBody("IDEMPOTENCY_KEY_CONFLICT", error.message));
      }

      if (error instanceof QuotaExceededError) {
        return reply.code(429).send({
          error: "quota_exceeded",
          message: error.message,
          quota: error.quota,
        });
      }

      throw error;
    }
  });
};

