import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import {
  createStripeWebhookVerifier,
  loadStripeWebhookSecret,
  StripeWebhookConfigurationError,
} from "../../lib/stripe.js";
import {
  processVerifiedStripeEvent,
  StripeWebhookProcessingError,
} from "./stripe-webhook.service.js";
import type { WebhookDependencies } from "./stripe-webhook.types.js";

const readSignature = (request: FastifyRequest): string | undefined => {
  const value = request.headers["stripe-signature"];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const registerStripeWebhookRoutes = (
  app: FastifyInstance,
  prisma: PrismaClient,
  dependencies: WebhookDependencies = {},
): void => {
  app.post("/webhooks/stripe", async (request, reply) => {
    const signature = readSignature(request);
    if (!signature) {
      return reply.code(400).send({
        error: {
          code: "MISSING_STRIPE_SIGNATURE",
          message: "stripe-signature header is required.",
        },
      });
    }

    if (!Buffer.isBuffer(request.body)) {
      return reply.code(400).send({
        error: {
          code: "INVALID_WEBHOOK_PAYLOAD",
          message: "Stripe webhook payload must be raw JSON bytes.",
        },
      });
    }

    let webhookSecret: string;
    try {
      webhookSecret =
        dependencies.webhookSecret ?? loadStripeWebhookSecret();
    } catch (error) {
      if (error instanceof StripeWebhookConfigurationError) {
        return reply.code(503).send({
          error: {
            code: "STRIPE_WEBHOOK_NOT_CONFIGURED",
            message: error.message,
          },
        });
      }
      throw error;
    }

    const verifier =
      dependencies.verifier ?? createStripeWebhookVerifier();

    let event;
    try {
      event = verifier.constructEvent(
        request.body,
        signature,
        webhookSecret,
      );
    } catch {
      return reply.code(400).send({
        error: {
          code: "INVALID_STRIPE_SIGNATURE",
          message: "Stripe webhook signature verification failed.",
        },
      });
    }

    try {
      const result = await processVerifiedStripeEvent(prisma, event);
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof StripeWebhookProcessingError) {
        return reply.code(422).send({
          error: {
            code: "STRIPE_WEBHOOK_PROCESSING_FAILED",
            message: error.message,
          },
        });
      }
      throw error;
    }
  });
};
