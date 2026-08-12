import Stripe from "stripe";
import { z } from "zod";

export interface StripeCheckoutConfig {
  secretKey: string;
  proPriceId: string;
  appBaseUrl: string;
}

export interface CreateStripeCustomerInput {
  name: string;
  metadata: {
    tenantId: string;
  };
}

export interface CreateStripeCheckoutSessionInput {
  customer: string;
  mode: "subscription";
  line_items: Array<{
    price: string;
    quantity: 1;
  }>;
  metadata: {
    tenantId: string;
  };
  subscription_data: {
    metadata: {
      tenantId: string;
    };
  };
  success_url: string;
  cancel_url: string;
}

export interface StripeGateway {
  createCustomer(
    input: CreateStripeCustomerInput,
  ): Promise<{ id: string }>;
  createCheckoutSession(
    input: CreateStripeCheckoutSessionInput,
  ): Promise<{ id: string; url: string | null }>;
}

export class StripeConfigurationError extends Error {
  constructor() {
    super("Stripe Checkout is not configured.");
    this.name = "StripeConfigurationError";
  }
}

const stripeConfigSchema = z.object({
  STRIPE_SECRET_KEY: z.string().regex(/^sk_test_[A-Za-z0-9_]+$/),
  STRIPE_PRO_PRICE_ID: z.string().regex(/^price_[A-Za-z0-9_]+$/),
  APP_BASE_URL: z.url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }),
});

export const loadStripeCheckoutConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): StripeCheckoutConfig => {
  const result = stripeConfigSchema.safeParse(environment);
  if (!result.success) {
    throw new StripeConfigurationError();
  }

  return {
    secretKey: result.data.STRIPE_SECRET_KEY,
    proPriceId: result.data.STRIPE_PRO_PRICE_ID,
    appBaseUrl: result.data.APP_BASE_URL.replace(/\/+$/, ""),
  };
};

export const createStripeGateway = (
  config: StripeCheckoutConfig,
): StripeGateway => {
  const stripe = new Stripe(config.secretKey);

  return {
    async createCustomer(input) {
      return stripe.customers.create(input);
    },
    async createCheckoutSession(input) {
      return stripe.checkout.sessions.create(input);
    },
  };
};
