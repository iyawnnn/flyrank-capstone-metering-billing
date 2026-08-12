import type { PrismaClient } from "@prisma/client";
import {
  createStripeGateway,
  loadStripeCheckoutConfig,
  type StripeCheckoutConfig,
  type StripeGateway,
} from "../../lib/stripe.js";
import {
  findTenantForCheckout,
  updateTenantStripeCustomerId,
} from "../tenants/tenant.repository.js";

export class CheckoutTenantNotFoundError extends Error {
  constructor() {
    super("Tenant not found.");
    this.name = "CheckoutTenantNotFoundError";
  }
}

export class StripeCheckoutError extends Error {
  constructor() {
    super("Unable to create Stripe Checkout Session.");
    this.name = "StripeCheckoutError";
  }
}

export interface BillingDependencies {
  stripeGateway?: StripeGateway;
  stripeConfig?: StripeCheckoutConfig;
}

export interface CheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
}

export const createProCheckout = async (
  prisma: PrismaClient,
  tenantId: string,
  dependencies: BillingDependencies = {},
): Promise<CheckoutResponse> => {
  const tenant = await findTenantForCheckout(prisma, tenantId);
  if (!tenant) {
    throw new CheckoutTenantNotFoundError();
  }

  const config =
    dependencies.stripeConfig ?? loadStripeCheckoutConfig();
  const gateway =
    dependencies.stripeGateway ?? createStripeGateway(config);

  let stripeCustomerId = tenant.stripeCustomerId;
  if (!stripeCustomerId) {
    let customer: { id: string };
    try {
      customer = await gateway.createCustomer({
        name: tenant.name,
        metadata: { tenantId },
      });
    } catch {
      throw new StripeCheckoutError();
    }

    stripeCustomerId = customer.id;
    await updateTenantStripeCustomerId(prisma, tenantId, stripeCustomerId);
  }

  try {
    const session = await gateway.createCheckoutSession({
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: config.proPriceId, quantity: 1 }],
      metadata: { tenantId },
      subscription_data: {
        metadata: { tenantId },
      },
      success_url:
        config.appBaseUrl +
        "/billing/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: config.appBaseUrl + "/billing/cancel",
    });

    if (!session.url) {
      throw new StripeCheckoutError();
    }

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  } catch (error) {
    if (error instanceof StripeCheckoutError) {
      throw error;
    }
    throw new StripeCheckoutError();
  }
};
