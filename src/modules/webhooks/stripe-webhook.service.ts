import {
  PlanName,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
} from "@prisma/client";
import type {
  VerifiedStripeEvent,
  WebhookResult,
} from "./stripe-webhook.types.js";

export class StripeWebhookProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeWebhookProcessingError";
  }
}

const readString = (
  object: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = object[field];
  if (typeof value === "string" && value) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }
  return undefined;
};

const readTenantMetadata = (
  object: Record<string, unknown>,
): string | undefined => {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  const tenantId = (metadata as Record<string, unknown>).tenantId;
  return typeof tenantId === "string" && tenantId ? tenantId : undefined;
};

const unixDate = (value: unknown): Date | null =>
  typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1_000)
    : null;

const requirePlan = async (
  transaction: Prisma.TransactionClient,
  name: PlanName,
) => {
  const plan = await transaction.plan.findUnique({ where: { name } });
  if (!plan) {
    throw new StripeWebhookProcessingError(name + " plan not found.");
  }
  return plan;
};

const requireTenant = async (
  transaction: Prisma.TransactionClient,
  tenantId: string,
) => {
  const tenant = await transaction.tenant.findUnique({
    where: { id: tenantId },
  });
  if (!tenant) {
    throw new StripeWebhookProcessingError("Webhook tenant not found.");
  }
  return tenant;
};

const resolveTenant = async (
  transaction: Prisma.TransactionClient,
  object: Record<string, unknown>,
) => {
  const metadataTenantId = readTenantMetadata(object);
  if (metadataTenantId) {
    return requireTenant(transaction, metadataTenantId);
  }

  const subscriptionId = readString(object, "id");
  if (subscriptionId) {
    const stored = await transaction.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      include: { tenant: true },
    });
    if (stored) {
      return stored.tenant;
    }
  }

  const customerId = readString(object, "customer");
  if (customerId) {
    const tenant = await transaction.tenant.findUnique({
      where: { stripeCustomerId: customerId },
    });
    if (tenant) {
      return tenant;
    }
  }

  throw new StripeWebhookProcessingError(
    "Unable to resolve tenant from verified Stripe event.",
  );
};

interface StatusMapping {
  tenantStatus: SubscriptionStatus;
  subscriptionStatus: SubscriptionStatus;
  planName: PlanName;
}

const mapSubscriptionStatus = (status: unknown): StatusMapping => {
  if (status === "active" || status === "trialing") {
    return {
      tenantStatus: SubscriptionStatus.ACTIVE,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      planName: PlanName.PRO,
    };
  }
  if (status === "past_due") {
    return {
      tenantStatus: SubscriptionStatus.PAST_DUE,
      subscriptionStatus: SubscriptionStatus.PAST_DUE,
      planName: PlanName.PRO,
    };
  }
  if (status === "incomplete" || status === "incomplete_expired") {
    return {
      tenantStatus: SubscriptionStatus.INCOMPLETE,
      subscriptionStatus: SubscriptionStatus.INCOMPLETE,
      planName: PlanName.FREE,
    };
  }
  if (status === "canceled" || status === "unpaid") {
    return {
      tenantStatus: SubscriptionStatus.CANCELED,
      subscriptionStatus: SubscriptionStatus.CANCELED,
      planName: PlanName.FREE,
    };
  }

  throw new StripeWebhookProcessingError(
    "Unsupported Stripe subscription status.",
  );
};

const processCheckoutCompleted = async (
  transaction: Prisma.TransactionClient,
  session: Record<string, unknown>,
): Promise<void> => {
  if (session.status !== "complete") {
    throw new StripeWebhookProcessingError(
      "Checkout Session is not complete.",
    );
  }

  const tenantId = readTenantMetadata(session);
  const customerId = readString(session, "customer");
  const subscriptionId = readString(session, "subscription");
  if (!tenantId || !customerId || !subscriptionId) {
    throw new StripeWebhookProcessingError(
      "Verified Checkout Session is missing tenant, customer, or subscription.",
    );
  }

  const tenant = await requireTenant(transaction, tenantId);
  const proPlan = await requirePlan(transaction, PlanName.PRO);

  await transaction.subscription.upsert({
    where: { stripeSubscriptionId: subscriptionId },
    update: {
      tenantId: tenant.id,
      stripeCustomerId: customerId,
      status: SubscriptionStatus.ACTIVE,
    },
    create: {
      tenantId: tenant.id,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      status: SubscriptionStatus.ACTIVE,
    },
  });

  await transaction.tenant.update({
    where: { id: tenant.id },
    data: {
      planId: proPlan.id,
      stripeCustomerId: customerId,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    },
  });
};

const processSubscriptionUpdated = async (
  transaction: Prisma.TransactionClient,
  subscription: Record<string, unknown>,
): Promise<void> => {
  const subscriptionId = readString(subscription, "id");
  const customerId = readString(subscription, "customer");
  if (!subscriptionId || !customerId) {
    throw new StripeWebhookProcessingError(
      "Verified subscription is missing its ID or customer.",
    );
  }

  const tenant = await resolveTenant(transaction, subscription);
  const mapping = mapSubscriptionStatus(subscription.status);
  const plan = await requirePlan(transaction, mapping.planName);

  await transaction.subscription.upsert({
    where: { stripeSubscriptionId: subscriptionId },
    update: {
      tenantId: tenant.id,
      stripeCustomerId: customerId,
      status: mapping.subscriptionStatus,
      currentPeriodStart: unixDate(subscription.current_period_start),
      currentPeriodEnd: unixDate(subscription.current_period_end),
    },
    create: {
      tenantId: tenant.id,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      status: mapping.subscriptionStatus,
      currentPeriodStart: unixDate(subscription.current_period_start),
      currentPeriodEnd: unixDate(subscription.current_period_end),
    },
  });

  await transaction.tenant.update({
    where: { id: tenant.id },
    data: {
      planId: plan.id,
      stripeCustomerId: customerId,
      subscriptionStatus: mapping.tenantStatus,
    },
  });
};

const processSubscriptionDeleted = async (
  transaction: Prisma.TransactionClient,
  subscription: Record<string, unknown>,
): Promise<void> => {
  const tenant = await resolveTenant(transaction, subscription);
  const freePlan = await requirePlan(transaction, PlanName.FREE);
  const subscriptionId = readString(subscription, "id");

  if (subscriptionId) {
    await transaction.subscription.updateMany({
      where: {
        stripeSubscriptionId: subscriptionId,
        tenantId: tenant.id,
      },
      data: { status: SubscriptionStatus.CANCELED },
    });
  }

  await transaction.tenant.update({
    where: { id: tenant.id },
    data: {
      planId: freePlan.id,
      subscriptionStatus: SubscriptionStatus.CANCELED,
    },
  });
};

const RETRIES = 3;

export const processVerifiedStripeEvent = async (
  prisma: PrismaClient,
  event: VerifiedStripeEvent,
): Promise<WebhookResult> => {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          const existing = await transaction.stripeEvent.findUnique({
            where: { stripeEventId: event.id },
          });
          if (existing) {
            return { received: true, duplicate: true, ignored: false };
          }

          await transaction.stripeEvent.create({
            data: {
              stripeEventId: event.id,
              type: event.type,
            },
          });

          let ignored = false;
          if (event.type === "checkout.session.completed") {
            await processCheckoutCompleted(transaction, event.data.object);
          } else if (event.type === "customer.subscription.updated") {
            await processSubscriptionUpdated(transaction, event.data.object);
          } else if (event.type === "customer.subscription.deleted") {
            await processSubscriptionDeleted(transaction, event.data.object);
          } else {
            ignored = true;
          }

          await transaction.stripeEvent.update({
            where: { stripeEventId: event.id },
            data: { processedAt: new Date() },
          });

          return { received: true, duplicate: false, ignored };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        const existing = await prisma.stripeEvent.findUnique({
          where: { stripeEventId: event.id },
        });
        if (existing) {
          return { received: true, duplicate: true, ignored: false };
        }
        if (attempt < RETRIES) {
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error("Webhook transaction retry limit reached.");
};
