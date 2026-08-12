export interface VerifiedStripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

export interface StripeWebhookVerifier {
  constructEvent(
    payload: Buffer,
    signature: string,
    webhookSecret: string,
  ): VerifiedStripeEvent;
}

export interface WebhookDependencies {
  verifier?: StripeWebhookVerifier;
  webhookSecret?: string;
}

export interface WebhookResult {
  received: true;
  duplicate: boolean;
  ignored: boolean;
}
