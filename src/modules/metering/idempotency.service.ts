import type { Prisma } from "@prisma/client";

export const findIdempotencyRecord = (
  transaction: Prisma.TransactionClient,
  tenantId: string,
  key: string,
) =>
  transaction.idempotencyKey.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
