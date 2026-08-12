import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import {
  getCurrentMonthUsage,
  UsageTenantNotFoundError,
} from "./usage.service.js";

const readTenantId = (request: FastifyRequest): string | undefined => {
  const value = request.headers["x-tenant-id"];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const registerUsageRoutes = (
  app: FastifyInstance,
  prisma: PrismaClient,
): void => {
  app.get("/usage", async (request, reply) => {
    const tenantId = readTenantId(request);
    if (!tenantId) {
      return reply.code(400).send({
        error: {
          code: "MISSING_TENANT_ID",
          message: "x-tenant-id header is required.",
        },
      });
    }

    try {
      const summary = await getCurrentMonthUsage(prisma, tenantId);
      return reply.code(200).send(summary);
    } catch (error) {
      if (error instanceof UsageTenantNotFoundError) {
        return reply.code(404).send({
          error: {
            code: "TENANT_NOT_FOUND",
            message: error.message,
          },
        });
      }

      throw error;
    }
  });
};
