import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { StripeConfigurationError } from "../../lib/stripe.js";
import {
  type BillingDependencies,
  CheckoutTenantNotFoundError,
  createProCheckout,
  StripeCheckoutError,
} from "./billing.service.js";

const readTenantId = (request: FastifyRequest): string | undefined => {
  const value = request.headers["x-tenant-id"];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const registerBillingRoutes = (
  app: FastifyInstance,
  prisma: PrismaClient,
  dependencies: BillingDependencies = {},
): void => {
  app.post("/billing/checkout", async (request, reply) => {
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
      const checkout = await createProCheckout(
        prisma,
        tenantId,
        dependencies,
      );
      return reply.code(200).send(checkout);
    } catch (error) {
      if (error instanceof CheckoutTenantNotFoundError) {
        return reply.code(404).send({
          error: {
            code: "TENANT_NOT_FOUND",
            message: error.message,
          },
        });
      }

      if (error instanceof StripeConfigurationError) {
        return reply.code(503).send({
          error: {
            code: "STRIPE_NOT_CONFIGURED",
            message: error.message,
          },
        });
      }

      if (error instanceof StripeCheckoutError) {
        return reply.code(502).send({
          error: {
            code: "STRIPE_CHECKOUT_FAILED",
            message: error.message,
          },
        });
      }

      throw error;
    }
  });
};
