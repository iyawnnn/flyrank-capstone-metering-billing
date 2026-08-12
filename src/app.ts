import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./lib/prisma.js";
import { registerGenerateRoutes } from "./modules/generate/generate.routes.js";
import { registerUsageRoutes } from "./modules/usage/usage.routes.js";
import {
  registerBillingRoutes,
} from "./modules/billing/billing.routes.js";
import type { BillingDependencies } from "./modules/billing/billing.service.js";

interface CreateAppOptions {
  prisma?: PrismaClient;
  billing?: BillingDependencies;
}

export const createApp = (
  options: CreateAppOptions = {},
): FastifyInstance => {
  const app = Fastify({ logger: false });
  const prisma = options.prisma ?? defaultPrisma;

  app.get("/health", async () => {
    return { status: "ok" };
  });

  registerGenerateRoutes(app, prisma);
  registerUsageRoutes(app, prisma);
  registerBillingRoutes(app, prisma, options.billing);

  return app;
};


