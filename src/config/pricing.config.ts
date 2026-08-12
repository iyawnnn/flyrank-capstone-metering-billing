export const PRICING = {
  apiCallMicroCents: 10n,
  tokenRateDenominator: 1_000_000n,
  tokenRatesMicroCentsPerMillion: {
    input: 100_000n,
    cachedInput: 25_000n,
    output: 500_000n,
  },
} as const;
