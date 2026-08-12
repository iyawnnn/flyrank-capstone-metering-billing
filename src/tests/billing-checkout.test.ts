import {
  PlanName,
  PrismaClient,
  SubscriptionStatus,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../prisma/seed.js";
import { createApp } from "../app.js";
import type {
  CreateStripeCheckoutSessionInput,
  CreateStripeCustomerInput,
  StripeCheckoutConfig,
  StripeGateway,
} from "../lib/stripe.js";
import type { BillingDependencies } from "../modules/billing/billing.service.js";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/metering_billing?schema=public";

const prisma = new PrismaClient();
const tenantId = "tenant_phase7_checkout";
const existingCustomerTenantId = "tenant_phase7_existing_customer";

const config: StripeCheckoutConfig = {
  secretKey: "sk_test_unit_test_only",
  proPriceId: "price_test_pro_monthly",
  appBaseUrl: "http://localhost:3000",
};

interface MockStripe {
  gateway: StripeGateway;
  customerCalls: CreateStripeCustomerInput[];
  sessionCalls: CreateStripeCheckoutSessionInput[];
}

const createMockStripe = (): MockStripe => {
  const customerCalls: CreateStripeCustomerInput[] = [];
  const sessionCalls: CreateStripeCheckoutSessionInput[] = [];

  return {
    customerCalls,
    sessionCalls,
    gateway: {
      async createCustomer(input) {
        customerCalls.push(input);
        return { id: "cus_test_created" };
      },
      async createCheckoutSession(input) {
        sessionCalls.push(input);
        return {
          id: "cs_test_checkout",
          url: "https://checkout.stripe.com/c/pay/cs_test_checkout",
        };
      },
    },
  };
};

const cleanup = async (): Promise<void> => {
  await prisma.tenant.deleteMany({
    where: {
      id: { in: [tenantId, existingCustomerTenantId] },
    },
  });
};

const createFreeTenant = async (
  id: string,
  stripeCustomerId?: string,
): Promise<void> => {
  const freePlan = await prisma.plan.findUniqueOrThrow({
    where: { name: PlanName.FREE },
  });

  await prisma.tenant.create({
    data: {
      id,
      name: "Phase 7 Checkout Tenant",
      planId: freePlan.id,
      stripeCustomerId,
      subscriptionStatus: SubscriptionStatus.FREE,
    },
  });
};

const checkout = async (
  targetTenantId: string | undefined,
  billing?: BillingDependencies,
) => {
  const app = createApp({ prisma, billing });
  const headers =
    targetTenantId === undefined
      ? {}
      : { "x-tenant-id": targetTenantId };

  try {
    return await app.inject({
      method: "POST",
      url: "/billing/checkout",
      headers,
    });
  } finally {
    await app.close();
  }
};

describe.sequential("POST /billing/checkout", () => {
  beforeAll(async () => {
    await seedDatabase(prisma);
  });

  beforeEach(async () => {
    await cleanup();
    await createFreeTenant(tenantId);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("returns 400 when x-tenant-id is missing", async () => {
    const mock = createMockStripe();
    const response = await checkout(undefined, {
      stripeConfig: config,
      stripeGateway: mock.gateway,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MISSING_TENANT_ID");
    expect(mock.customerCalls).toHaveLength(0);
    expect(mock.sessionCalls).toHaveLength(0);
  });

  it("returns 404 for an unknown tenant before calling Stripe", async () => {
    const mock = createMockStripe();
    const response = await checkout("tenant_does_not_exist", {
      stripeConfig: config,
      stripeGateway: mock.gateway,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("TENANT_NOT_FOUND");
    expect(mock.customerCalls).toHaveLength(0);
    expect(mock.sessionCalls).toHaveLength(0);
  });

  it("returns a clean 503 when Stripe configuration is missing", async () => {
    const names = [
      "STRIPE_SECRET_KEY",
      "STRIPE_PRO_PRICE_ID",
      "APP_BASE_URL",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    names.forEach((name) => delete process.env[name]);

    try {
      const response = await checkout(tenantId);

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: {
          code: "STRIPE_NOT_CONFIGURED",
          message: "Stripe Checkout is not configured.",
        },
      });
      expect(response.body).not.toContain("sk_");
    } finally {
      names.forEach((name) => {
        const value = previous[name];
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      });
    }
  });

  it("creates and persists a Stripe customer for a tenant without one", async () => {
    const mock = createMockStripe();
    const response = await checkout(tenantId, {
      stripeConfig: config,
      stripeGateway: mock.gateway,
    });

    expect(response.statusCode).toBe(200);
    expect(mock.customerCalls).toEqual([
      {
        name: "Phase 7 Checkout Tenant",
        metadata: { tenantId },
      },
    ]);
    expect(
      await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { stripeCustomerId: true },
      }),
    ).toEqual({ stripeCustomerId: "cus_test_created" });
  });

  it("reuses an existing Stripe customer without creating another", async () => {
    await createFreeTenant(existingCustomerTenantId, "cus_test_existing");
    const mock = createMockStripe();

    const response = await checkout(existingCustomerTenantId, {
      stripeConfig: config,
      stripeGateway: mock.gateway,
    });

    expect(response.statusCode).toBe(200);
    expect(mock.customerCalls).toHaveLength(0);
    expect(mock.sessionCalls[0]?.customer).toBe("cus_test_existing");
  });

  it("creates a Pro subscription Checkout Session with tenant metadata and safe URLs", async () => {
    const mock = createMockStripe();

    const response = await checkout(tenantId, {
      stripeConfig: config,
      stripeGateway: mock.gateway,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      checkoutUrl:
        "https://checkout.stripe.com/c/pay/cs_test_checkout",
      sessionId: "cs_test_checkout",
    });
    expect(mock.sessionCalls).toEqual([
      {
        customer: "cus_test_created",
        mode: "subscription",
        line_items: [{ price: "price_test_pro_monthly", quantity: 1 }],
        metadata: { tenantId },
        subscription_data: {
          metadata: { tenantId },
        },
        success_url:
          "http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "http://localhost:3000/billing/cancel",
      },
    ]);
  });

  it("does not upgrade the tenant plan or subscription status", async () => {
    const before = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { plan: true },
    });
    const mock = createMockStripe();

    const response = await checkout(tenantId, {
      stripeConfig: config,
      stripeGateway: mock.gateway,
    });
    const after = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { plan: true },
    });

    expect(response.statusCode).toBe(200);
    expect(before.plan.name).toBe(PlanName.FREE);
    expect(after.planId).toBe(before.planId);
    expect(after.plan.name).toBe(PlanName.FREE);
    expect(after.subscriptionStatus).toBe(SubscriptionStatus.FREE);
  });
});
