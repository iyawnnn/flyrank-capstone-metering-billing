import { PRICING } from "../../config/pricing.config.js";
import type {
  GenerationCost,
  TokenCostBreakdown,
  TokenUsageForPricing,
} from "./pricing.types.js";

const assertNonnegativeSafeInteger = (
  value: number,
  field: string,
): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(field + " must be a nonnegative safe integer.");
  }
};

const divideRoundingUp = (
  numerator: bigint,
  denominator: bigint,
): bigint =>
  numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;

const priceTokenCategory = (
  tokens: number,
  rateMicroCentsPerMillion: bigint,
): bigint => {
  assertNonnegativeSafeInteger(tokens, "tokens");

  return divideRoundingUp(
    BigInt(tokens) * rateMicroCentsPerMillion,
    PRICING.tokenRateDenominator,
  );
};

export const calculateApiCallCost = (apiCalls: number): bigint => {
  assertNonnegativeSafeInteger(apiCalls, "apiCalls");
  return BigInt(apiCalls) * PRICING.apiCallMicroCents;
};

export const calculateTokenCost = (
  usage: TokenUsageForPricing,
): TokenCostBreakdown => {
  const inputMicroCents = priceTokenCategory(
    usage.inputTokens,
    PRICING.tokenRatesMicroCentsPerMillion.input,
  );
  const cachedInputMicroCents = priceTokenCategory(
    usage.cachedInputTokens,
    PRICING.tokenRatesMicroCentsPerMillion.cachedInput,
  );
  const outputMicroCents = priceTokenCategory(
    usage.outputTokens,
    PRICING.tokenRatesMicroCentsPerMillion.output,
  );
  const reasoningMicroCents = priceTokenCategory(
    usage.reasoningTokens,
    PRICING.tokenRatesMicroCentsPerMillion.output,
  );

  return {
    inputMicroCents,
    cachedInputMicroCents,
    outputMicroCents,
    reasoningMicroCents,
    totalMicroCents:
      inputMicroCents +
      cachedInputMicroCents +
      outputMicroCents +
      reasoningMicroCents,
  };
};

export const calculateGenerationCost = (
  usage: TokenUsageForPricing,
): GenerationCost => {
  const apiCallMicroCents = calculateApiCallCost(1);
  const tokenBreakdown = calculateTokenCost(usage);
  const aiTokensMicroCents = tokenBreakdown.totalMicroCents;

  return {
    apiCallMicroCents,
    aiTokensMicroCents,
    totalMicroCents: apiCallMicroCents + aiTokensMicroCents,
    tokenBreakdown,
  };
};

export const toSafeMoneyNumber = (value: bigint): number => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Money value exceeds the JSON safe-integer range.");
  }
  return result;
};
