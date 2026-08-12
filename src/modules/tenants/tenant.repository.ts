import type { Prisma } from "@prisma/client";

export const findTenantById = (
  transaction: Prisma.TransactionClient,
  tenantId: string,
) =>
  transaction.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
