export interface TokenUsageForPricing {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface TokenCostBreakdown {
  inputMicroCents: bigint;
  cachedInputMicroCents: bigint;
  outputMicroCents: bigint;
  reasoningMicroCents: bigint;
  totalMicroCents: bigint;
}

export interface GenerationCost {
  apiCallMicroCents: bigint;
  aiTokensMicroCents: bigint;
  totalMicroCents: bigint;
  tokenBreakdown: TokenCostBreakdown;
}
