import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./lib/prisma.js";
import { registerGenerateRoutes } from "./modules/generate/generate.routes.js";

interface CreateAppOptions {
  prisma?: PrismaClient;
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

  return app;
};
