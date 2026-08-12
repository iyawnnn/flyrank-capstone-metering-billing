import {
  PlanName,
  PrismaClient,
  SubscriptionStatus,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../prisma/seed.js";
import { createApp } from "../app.js";
import type {
  StripeWebhookVerifier,
  VerifiedStripeEvent,
} from "../modules/webhooks/stripe-webhook.types.js";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/metering_billing?schema=public";

const prisma = new PrismaClient();
const tenantId = "tenant_phase8_webhook";
const eventPrefix = "evt_phase8_";
const validSignature = "valid_test_signature";
let verifierReceivedBuffer = false;

const verifier: StripeWebhookVerifier = {
  constructEvent(payload, signature) {
    verifierReceivedBuffer = Buffer.isBuffer(payload);
    if (signature !== validSignature) {
      throw new Error("Forged signature");
    }
    return JSON.parse(payload.toString("utf8")) as VerifiedStripeEvent;
  },
};

const cleanup = async (): Promise<void> => {
  await prisma.stripeEvent.deleteMany({
    where: { stripeEventId: { startsWith: eventPrefix } },
  });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
};

const createFreeTenant = async (): Promise<void> => {
  const freePlan = await prisma.plan.findUniqueOrThrow({
    where: { name: PlanName.FREE },
  });
  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: "Phase 8 Webhook Tenant",
      planId: freePlan.id,
      subscriptionStatus: SubscriptionStatus.FREE,
    },
  });
};

const postWebhook = async (
  event: VerifiedStripeEvent,
  signature?: string,
) => {
  const app = createApp({
    prisma,
    webhooks: {
      verifier,
      webhookSecret: "whsec_unit_test_only",
    },
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (signature !== undefined) {
    headers["stripe-signature"] = signature;
  }

  try {
    return await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers,
      payload: JSON.stringify(event),
    });
  } finally {
    await app.close();
  }
};

const checkoutEvent = (
  id = eventPrefix + "checkout",
): VerifiedStripeEvent => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_phase8",
      status: "complete",
      customer: "cus_test_phase8",
      subscription: "sub_test_phase8",
      metadata: { tenantId },
    },
  },
});

const subscriptionEvent = (
  id: string,
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  status: string,
  metadata: Record<string, string> = { tenantId },
): VerifiedStripeEvent => ({
  id,
  type,
  data: {
    object: {
      id: "sub_test_phase8",
      customer: "cus_test_phase8",
      status,
      metadata,
      current_period_start: 1_786_060_800,
      current_period_end: 1_788_739_200,
    },
  },
});

const tenantState = () =>
  prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { plan: true, subscriptions: true },
  });

describe.sequential("POST /webhooks/stripe", () => {
  beforeAll(async () => {
    await seedDatabase(prisma);
  });

  beforeEach(async () => {
    verifierReceivedBuffer = false;
    await cleanup();
    await createFreeTenant();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns 400 when stripe-signature is missing", async () => {
    const response = await postWebhook(checkoutEvent());

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MISSING_STRIPE_SIGNATURE");
    expect(await prisma.stripeEvent.count({
      where: { stripeEventId: { startsWith: eventPrefix } },
    })).toBe(0);
  });

  it("rejects an invalid signature and preserves raw Buffer verification", async () => {
    const response = await postWebhook(checkoutEvent(), "forged");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_STRIPE_SIGNATURE",
        message: "Stripe webhook signature verification failed.",
      },
    });
    expect(verifierReceivedBuffer).toBe(true);
  });

  it("a forged webhook changes no tenant data and creates no StripeEvent", async () => {
    const before = await tenantState();

    await postWebhook(checkoutEvent(), "forged");

    const after = await tenantState();
    expect(after.planId).toBe(before.planId);
    expect(after.subscriptionStatus).toBe(SubscriptionStatus.FREE);
    expect(after.stripeCustomerId).toBeNull();
    expect(after.subscriptions).toHaveLength(0);
    expect(await prisma.stripeEvent.count({
      where: { stripeEventId: { startsWith: eventPrefix } },
    })).toBe(0);
  });

  it("verified checkout completion upgrades Free to Pro and saves the customer", async () => {
    const response = await postWebhook(checkoutEvent(), validSignature);
    const tenant = await tenantState();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      received: true,
      duplicate: false,
      ignored: false,
    });
    expect(tenant.plan.name).toBe(PlanName.PRO);
    expect(tenant.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(tenant.stripeCustomerId).toBe("cus_test_phase8");
  });

  it("verified checkout completion creates the Subscription projection", async () => {
    await postWebhook(checkoutEvent(), validSignature);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: "sub_test_phase8" },
    });
    expect(subscription).toMatchObject({
      tenantId,
      stripeCustomerId: "cus_test_phase8",
      status: SubscriptionStatus.ACTIVE,
    });
  });

  it("deduplicates checkout.session.completed by Stripe event ID", async () => {
    const event = checkoutEvent();
    const first = await postWebhook(event, validSignature);
    const duplicate = await postWebhook(event, validSignature);

    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      received: true,
      duplicate: true,
      ignored: false,
    });
    expect(await prisma.stripeEvent.count({
      where: { stripeEventId: event.id },
    })).toBe(1);
    expect(await prisma.subscription.count({
      where: { stripeSubscriptionId: "sub_test_phase8" },
    })).toBe(1);
  });

  it("maps an active subscription update to Pro and ACTIVE with periods", async () => {
    const event = subscriptionEvent(
      eventPrefix + "updated_active",
      "customer.subscription.updated",
      "active",
    );

    const response = await postWebhook(event, validSignature);
    const tenant = await tenantState();
    const subscription = tenant.subscriptions[0];

    expect(response.statusCode).toBe(200);
    expect(tenant.plan.name).toBe(PlanName.PRO);
    expect(tenant.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(subscription?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(subscription?.currentPeriodStart).toEqual(
      new Date(1_786_060_800_000),
    );
    expect(subscription?.currentPeriodEnd).toEqual(
      new Date(1_788_739_200_000),
    );
  });

  it("maps past_due to Pro and PAST_DUE", async () => {
    const event = subscriptionEvent(
      eventPrefix + "updated_past_due",
      "customer.subscription.updated",
      "past_due",
    );

    await postWebhook(event, validSignature);
    const tenant = await tenantState();

    expect(tenant.plan.name).toBe(PlanName.PRO);
    expect(tenant.subscriptionStatus).toBe(SubscriptionStatus.PAST_DUE);
    expect(tenant.subscriptions[0]?.status).toBe(
      SubscriptionStatus.PAST_DUE,
    );
  });

  it("falls back to the stored subscription when update metadata is absent", async () => {
    await postWebhook(checkoutEvent(), validSignature);
    const event = subscriptionEvent(
      eventPrefix + "updated_fallback",
      "customer.subscription.updated",
      "active",
      {},
    );

    const response = await postWebhook(event, validSignature);

    expect(response.statusCode).toBe(200);
    expect((await tenantState()).subscriptionStatus).toBe(
      SubscriptionStatus.ACTIVE,
    );
  });

  it("deletion downgrades the tenant to Free and CANCELED", async () => {
    await postWebhook(checkoutEvent(), validSignature);
    const event = subscriptionEvent(
      eventPrefix + "deleted",
      "customer.subscription.deleted",
      "canceled",
    );

    const response = await postWebhook(event, validSignature);
    const tenant = await tenantState();

    expect(response.statusCode).toBe(200);
    expect(tenant.plan.name).toBe(PlanName.FREE);
    expect(tenant.subscriptionStatus).toBe(SubscriptionStatus.CANCELED);
    expect(tenant.subscriptions[0]?.status).toBe(
      SubscriptionStatus.CANCELED,
    );
  });

  it("deduplicates customer.subscription.deleted safely", async () => {
    await postWebhook(checkoutEvent(), validSignature);
    const event = subscriptionEvent(
      eventPrefix + "deleted_duplicate",
      "customer.subscription.deleted",
      "canceled",
    );

    await postWebhook(event, validSignature);
    const duplicate = await postWebhook(event, validSignature);

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().duplicate).toBe(true);
    expect(await prisma.stripeEvent.count({
      where: { stripeEventId: event.id },
    })).toBe(1);
    expect((await tenantState()).subscriptionStatus).toBe(
      SubscriptionStatus.CANCELED,
    );
  });

  it("acknowledges and records an unknown verified event as ignored", async () => {
    const event: VerifiedStripeEvent = {
      id: eventPrefix + "unknown",
      type: "invoice.created",
      data: { object: { id: "in_test_unknown" } },
    };

    const response = await postWebhook(event, validSignature);
    const stored = await prisma.stripeEvent.findUnique({
      where: { stripeEventId: event.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      received: true,
      duplicate: false,
      ignored: true,
    });
    expect(stored?.processedAt).toBeInstanceOf(Date);
  });

  it("returns a controlled error and rolls back the claim when tenant cannot resolve", async () => {
    const event = subscriptionEvent(
      eventPrefix + "missing_tenant",
      "customer.subscription.updated",
      "active",
      {},
    );
    event.data.object.id = "sub_unknown";
    event.data.object.customer = "cus_unknown";

    const response = await postWebhook(event, validSignature);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe(
      "STRIPE_WEBHOOK_PROCESSING_FAILED",
    );
    expect(await prisma.stripeEvent.count({
      where: { stripeEventId: event.id },
    })).toBe(0);
    expect((await tenantState()).plan.name).toBe(PlanName.FREE);
  });
});
