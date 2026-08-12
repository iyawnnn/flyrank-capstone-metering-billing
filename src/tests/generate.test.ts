import { PrismaClient, UsageType } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { seedDatabase } from "../../prisma/seed.js";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/metering_billing?schema=public";

const prisma = new PrismaClient();
const keyPrefix = "phase3-test-";
const validBody = {
  inputTokens: 1_000,
  cachedInputTokens: 200,
  outputTokens: 500,
  reasoningTokens: 100,
};

const removePhase3Fixtures = async (): Promise<void> => {
  await prisma.$transaction([
    prisma.usageEvent.deleteMany({
      where: { idempotencyKey: { startsWith: keyPrefix } },
    }),
    prisma.idempotencyKey.deleteMany({
      where: { key: { startsWith: keyPrefix } },
    }),
  ]);
};

const postGenerate = async (
  options: {
    tenantId?: string;
    idempotencyKey?: string;
    body?: unknown;
  } = {},
) => {
  const app = createApp({ prisma });
  const headers: Record<string, string> = {};

  if (options.tenantId !== undefined) {
    headers["x-tenant-id"] = options.tenantId;
  }
  if (options.idempotencyKey !== undefined) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  try {
    return await app.inject({
      method: "POST",
      url: "/generate",
      headers,
      payload: options.body ?? validBody,
    });
  } finally {
    await app.close();
  }
};

describe.sequential("POST /generate", () => {
  beforeAll(async () => {
    await seedDatabase(prisma);
  });

  beforeEach(removePhase3Fixtures);

  afterAll(async () => {
    await removePhase3Fixtures();
    await prisma.$disconnect();
  });

  it("returns 400 when x-tenant-id is missing without writing records", async () => {
    const key = keyPrefix + "missing-tenant";
    const response = await postGenerate({ idempotencyKey: key });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MISSING_TENANT_ID");
    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
  });

  it("returns 400 when idempotency-key is missing", async () => {
    const response = await postGenerate({ tenantId: "tenant_demo_free" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MISSING_IDEMPOTENCY_KEY");
  });

  it("returns 404 for an unknown tenant without writing records", async () => {
    const key = keyPrefix + "unknown-tenant";
    const response = await postGenerate({
      tenantId: "tenant_does_not_exist",
      idempotencyKey: key,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("TENANT_NOT_FOUND");
    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
  });

  it.each([
    [{ ...validBody, inputTokens: -1 }],
    [{ ...validBody, outputTokens: 1.5 }],
    [{ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }],
    [{ inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 }],
  ])("returns 400 for invalid token body %# without writes", async (body) => {
    const key = keyPrefix + "invalid-" + JSON.stringify(body);
    const response = await postGenerate({
      tenantId: "tenant_demo_free",
      idempotencyKey: key,
      body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST_BODY");
    expect(
      await prisma.usageEvent.count({ where: { idempotencyKey: key } }),
    ).toBe(0);
    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
  });

  it("creates one API call event and one summed AI token event", async () => {
    const key = keyPrefix + "new-request";
    const response = await postGenerate({
      tenantId: "tenant_demo_free",
      idempotencyKey: key,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      tenantId: "tenant_demo_free",
      idempotencyKey: key,
      simulated: true,
      usage: { apiCalls: 1, aiTokens: 1_800 },
      message: "Simulated generation completed.",
    });

    const events = await prisma.usageEvent.findMany({
      where: { tenantId: "tenant_demo_free", idempotencyKey: key },
      orderBy: { usageType: "asc" },
    });

    expect(events).toHaveLength(2);
    expect(
      events.find((event) => event.usageType === UsageType.API_CALL)?.quantity,
    ).toBe(1);
    expect(
      events.find((event) => event.usageType === UsageType.AI_TOKENS)?.quantity,
    ).toBe(1_800);
    expect(new Set(events.map((event) => event.requestHash)).size).toBe(1);
    expect(events.every((event) => event.costMicroCents === 0n)).toBe(true);
  });

  it("replays the exact response without creating more usage events", async () => {
    const key = keyPrefix + "replay";
    const request = {
      tenantId: "tenant_demo_free",
      idempotencyKey: key,
      body: validBody,
    };

    const original = await postGenerate(request);
    const replay = await postGenerate(request);

    expect(replay.statusCode).toBe(original.statusCode);
    expect(replay.body).toBe(original.body);
    expect(
      await prisma.usageEvent.count({
        where: { tenantId: "tenant_demo_free", idempotencyKey: key },
      }),
    ).toBe(2);
    expect(
      await prisma.idempotencyKey.count({
        where: { tenantId: "tenant_demo_free", key },
      }),
    ).toBe(1);
  });

  it("returns 409 for the same tenant and key with a different body", async () => {
    const key = keyPrefix + "conflict";
    await postGenerate({
      tenantId: "tenant_demo_free",
      idempotencyKey: key,
      body: validBody,
    });

    const conflict = await postGenerate({
      tenantId: "tenant_demo_free",
      idempotencyKey: key,
      body: { ...validBody, outputTokens: 501 },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(
      await prisma.usageEvent.count({
        where: { tenantId: "tenant_demo_free", idempotencyKey: key },
      }),
    ).toBe(2);
  });

  it("allows the same idempotency key for different tenants", async () => {
    const key = keyPrefix + "tenant-scoped";

    const [freeResponse, proResponse] = await Promise.all([
      postGenerate({
        tenantId: "tenant_demo_free",
        idempotencyKey: key,
      }),
      postGenerate({
        tenantId: "tenant_demo_pro",
        idempotencyKey: key,
      }),
    ]);

    expect(freeResponse.statusCode).toBe(200);
    expect(proResponse.statusCode).toBe(200);
    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(2);
    expect(
      await prisma.usageEvent.count({ where: { idempotencyKey: key } }),
    ).toBe(4);
  });

  it("meters concurrent identical retries only once", async () => {
    const key = keyPrefix + "concurrent";
    const request = {
      tenantId: "tenant_demo_free",
      idempotencyKey: key,
      body: validBody,
    };

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => postGenerate(request)),
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    expect(
      await prisma.usageEvent.count({
        where: { tenantId: "tenant_demo_free", idempotencyKey: key },
      }),
    ).toBe(2);
  });
});
