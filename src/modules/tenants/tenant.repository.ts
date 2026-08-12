import type { Prisma, PrismaClient } from "@prisma/client";

export const findTenantById = (
  transaction: Prisma.TransactionClient,
  tenantId: string,
) =>
  transaction.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      plan: {
        select: {
          monthlyApiCallLimit: true,
          monthlyTokenLimit: true,
        },
      },
    },
  });

export const findTenantUsageProfile = (
  prisma: PrismaClient,
  tenantId: string,
) =>
  prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      subscriptionStatus: true,
      plan: {
        select: {
          name: true,
          monthlyApiCallLimit: true,
          monthlyTokenLimit: true,
        },
      },
    },
  });

export const findTenantForCheckout = (
  prisma: PrismaClient,
  tenantId: string,
) =>
  prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      planId: true,
      subscriptionStatus: true,
    },
  });

export const updateTenantStripeCustomerId = (
  prisma: PrismaClient,
  tenantId: string,
  stripeCustomerId: string,
) =>
  prisma.tenant.update({
    where: { id: tenantId },
    data: { stripeCustomerId },
    select: { id: true, stripeCustomerId: true },
  });
