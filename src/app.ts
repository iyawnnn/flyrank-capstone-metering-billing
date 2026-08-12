import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./lib/prisma.js";
import { registerGenerateRoutes } from "./modules/generate/generate.routes.js";
import { registerUsageRoutes } from "./modules/usage/usage.routes.js";
import { registerBillingRoutes } from "./modules/billing/billing.routes.js";
import type { BillingDependencies } from "./modules/billing/billing.service.js";
import { registerStripeWebhookRoutes } from "./modules/webhooks/stripe-webhook.routes.js";
import type { WebhookDependencies } from "./modules/webhooks/stripe-webhook.types.js";

interface CreateAppOptions {
  prisma?: PrismaClient;
  billing?: BillingDependencies;
  webhooks?: WebhookDependencies;
}

export const createApp = (
  options: CreateAppOptions = {},
): FastifyInstance => {
  const app = Fastify({ logger: false });
  const prisma = options.prisma ?? defaultPrisma;

  // Stripe requires the exact bytes that were signed. Other JSON routes retain
  // normal parsing through the same content-type parser.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      const path = request.url.split("?")[0];
      if (path === "/webhooks/stripe") {
        done(null, body);
        return;
      }

      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch (error) {
        const parsingError =
          error instanceof Error ? error : new Error("Invalid JSON.");
        Object.assign(parsingError, { statusCode: 400 });
        done(parsingError);
      }
    },
  );

  app.get("/health", async () => {
    return { status: "ok" };
  });

  registerGenerateRoutes(app, prisma);
  registerUsageRoutes(app, prisma);
  registerBillingRoutes(app, prisma, options.billing);
  registerStripeWebhookRoutes(app, prisma, options.webhooks);

  return app;
};
