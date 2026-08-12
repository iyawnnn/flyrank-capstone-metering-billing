import { describe, expect, it } from "vitest";
import { PRICING } from "../config/pricing.config.js";
import {
  calculateApiCallCost,
  calculateGenerationCost,
  calculateTokenCost,
} from "../modules/pricing/pricing.service.js";

describe("integer micro-cent pricing", () => {
  it("prices one API call at exactly 10 micro-cents", () => {
    expect(calculateApiCallCost(1)).toBe(10n);
    expect(PRICING.apiCallMicroCents).toBe(10n);
  });

  it("uses the pinned normal input rate", () => {
    expect(
      calculateTokenCost({
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }).inputMicroCents,
    ).toBe(100_000n);
  });

  it("uses the cheaper cached-input rate", () => {
    expect(
      calculateTokenCost({
        inputTokens: 0,
        cachedInputTokens: 1_000_000,
        outputTokens: 0,
        reasoningTokens: 0,
      }).cachedInputMicroCents,
    ).toBe(25_000n);
  });

  it("uses the pinned output rate", () => {
    expect(
      calculateTokenCost({
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
        reasoningTokens: 0,
      }).outputMicroCents,
    ).toBe(500_000n);
  });

  it("charges reasoning tokens at the output rate", () => {
    const cost = calculateTokenCost({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 1_000_000,
    });

    expect(cost.reasoningMicroCents).toBe(500_000n);
    expect(cost.reasoningMicroCents).toBe(
      PRICING.tokenRatesMicroCentsPerMillion.output,
    );
  });

  it("prices categories separately and sums exact integer results", () => {
    const cost = calculateGenerationCost({
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 500,
      reasoningTokens: 100,
    });

    expect(cost.tokenBreakdown).toEqual({
      inputMicroCents: 100n,
      cachedInputMicroCents: 5n,
      outputMicroCents: 250n,
      reasoningMicroCents: 50n,
      totalMicroCents: 405n,
    });
    expect(cost).toMatchObject({
      apiCallMicroCents: 10n,
      aiTokensMicroCents: 405n,
      totalMicroCents: 415n,
    });
  });

  it("rounds each nonzero fractional category up to one micro-cent", () => {
    const cost = calculateTokenCost({
      inputTokens: 1,
      cachedInputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 1,
    });

    expect(cost).toEqual({
      inputMicroCents: 1n,
      cachedInputMicroCents: 1n,
      outputMicroCents: 1n,
      reasoningMicroCents: 1n,
      totalMicroCents: 4n,
    });
  });

  it("returns bigint values so stored money never uses floating point", () => {
    const cost = calculateGenerationCost({
      inputTokens: 123,
      cachedInputTokens: 456,
      outputTokens: 789,
      reasoningTokens: 10,
    });

    expect(typeof cost.apiCallMicroCents).toBe("bigint");
    expect(typeof cost.aiTokensMicroCents).toBe("bigint");
    expect(typeof cost.totalMicroCents).toBe("bigint");
    expect(
      Object.values(cost.tokenBreakdown).every(
        (value) => typeof value === "bigint",
      ),
    ).toBe(true);
  });
});
