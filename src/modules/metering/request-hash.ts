import { createHash } from "node:crypto";
import type { GenerateBody } from "../generate/generate.schemas.js";

export const createRequestHash = (body: GenerateBody): string => {
  const canonicalBody = JSON.stringify({
    inputTokens: body.inputTokens,
    cachedInputTokens: body.cachedInputTokens,
    outputTokens: body.outputTokens,
    reasoningTokens: body.reasoningTokens,
  });

  return createHash("sha256").update(canonicalBody).digest("hex");
};
