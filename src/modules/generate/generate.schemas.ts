import { z } from "zod";

export const generateBodySchema = z
  .object({
    inputTokens: z.number().int().nonnegative().safe(),
    cachedInputTokens: z.number().int().nonnegative().safe(),
    outputTokens: z.number().int().nonnegative().safe(),
    reasoningTokens: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((body, context) => {
    const values = [
      body.inputTokens,
      body.cachedInputTokens,
      body.outputTokens,
      body.reasoningTokens,
    ];
    const total = values.reduce((sum, value) => sum + value, 0);

    if (total === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one token field must be greater than 0.",
      });
    }

    if (!Number.isSafeInteger(total)) {
      context.addIssue({
        code: "custom",
        message: "The total token quantity must be a safe integer.",
      });
    }
  });

export type GenerateBody = z.infer<typeof generateBodySchema>;

export interface GenerateResponse {
  tenantId: string;
  idempotencyKey: string;
  simulated: true;
  usage: {
    apiCalls: 1;
    aiTokens: number;
  };
  message: "Simulated generation completed.";
}
