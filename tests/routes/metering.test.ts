import request from "supertest";
import app from "../../src/app";
import { findTenantByApiKey } from "../../src/database/queries/tenants";
import {
  findByIdempotencyKey,
  sumUsageForCurrentPeriod,
} from "../../src/database/queries/usageEvents";
import { getPlanForTenant } from "../../src/database/queries/subscriptions";
import { checkQuota } from "../../src/domain/quotas";
import { recordUsage } from "../../src/domain/metering";
import { calculateCost } from "../../src/domain/pricing";

jest.mock("../../src/database/queries/tenants", () => ({
  findTenantByApiKey: jest.fn(),
}));

jest.mock("../../src/database/queries/usageEvents", () => ({
  findByIdempotencyKey: jest.fn(),
  sumUsageForCurrentPeriod: jest.fn(),
}));

jest.mock("../../src/database/queries/subscriptions", () => ({
  getPlanForTenant: jest.fn(),
}));

jest.mock("../../src/domain/quotas", () => ({
  checkQuota: jest.fn(),
}));

jest.mock("../../src/domain/metering", () => ({
  recordUsage: jest.fn(),
}));

jest.mock("../../src/domain/pricing", () => ({
  calculateCost: jest.fn(),
}));

const mockedFindTenantByApiKey = jest.mocked(findTenantByApiKey);
const mockedFindByIdempotencyKey = jest.mocked(findByIdempotencyKey);
const mockedSumUsageForCurrentPeriod = jest.mocked(sumUsageForCurrentPeriod);
const mockedGetPlanForTenant = jest.mocked(getPlanForTenant);
const mockedCheckQuota = jest.mocked(checkQuota);
const mockedRecordUsage = jest.mocked(recordUsage);
const mockedCalculateCost = jest.mocked(calculateCost);

const usageEvent = {
  id: 42,
  tenantId: 7,
  idempotencyKey: "request-1",
  apiCalls: 1,
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 300,
  reasoningTokens: 40,
  createdAt: "2026-08-26T12:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedFindTenantByApiKey.mockResolvedValue({
    id: 7,
    publicId: "tenant-7",
    name: "Test Tenant",
    apiKey: "test-key",
    createdAt: "2026-08-26T12:00:00.000Z",
  });
  mockedCalculateCost.mockReturnValue({
    inputCostCents: 1,
    cachedInputCostCents: 0,
    outputCostCents: 1,
    totalCostCents: 2,
  });
});

describe("POST /generate", () => {
  test("requires authentication and an idempotency key", async () => {
    await expect(request(app).post("/generate")).resolves.toMatchObject({
      status: 401,
      body: { error: "Missing or malformed Authorization header" },
    });

    await expect(
      request(app).post("/generate").set("Authorization", "Bearer test-key")
    ).resolves.toMatchObject({
      status: 400,
      body: { error: "Missing required Idempotency-Key header" },
    });
  });

  test("rejects negative usage amounts", async () => {
    const response = await request(app)
      .post("/generate")
      .set("Authorization", "Bearer test-key")
      .set("Idempotency-Key", "request-1")
      .send({ outputTokens: -1 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Usage amounts must be non-negative numbers",
    });
    expect(mockedFindByIdempotencyKey).not.toHaveBeenCalled();
  });

  test("records allowed usage and returns the created event", async () => {
    mockedFindByIdempotencyKey.mockResolvedValue(null);
    mockedCheckQuota.mockResolvedValue({ allowed: true });
    mockedRecordUsage.mockResolvedValue({
      ...usageEvent,
      usageEventId: usageEvent.id,
      wasDuplicate: false,
    });

    const response = await request(app)
      .post("/generate")
      .set("Authorization", "Bearer test-key")
      .set("Idempotency-Key", "request-1")
      .send({ inputTokens: 100, outputTokens: 300 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      usageEventId: 42,
      wasDuplicate: false,
      apiCalls: 1,
      costCents: 2,
    });
    expect(mockedCheckQuota).toHaveBeenCalledWith({
      tenantId: 7,
      requestedApiCalls: 1,
      requestedTokens: 400,
    });
    expect(mockedRecordUsage).toHaveBeenCalledWith({
      tenantId: 7,
      idempotencyKey: "request-1",
      apiCalls: 1,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 300,
      reasoningTokens: 0,
    });
  });

  test("returns a duplicate before checking quota", async () => {
    mockedFindByIdempotencyKey.mockResolvedValue(usageEvent);

    const response = await request(app)
      .post("/generate")
      .set("Authorization", "Bearer test-key")
      .set("Idempotency-Key", "request-1")
      .send({ inputTokens: 999_999 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      usageEventId: 42,
      wasDuplicate: true,
      inputTokens: 100,
      costCents: 2,
    });
    expect(mockedCheckQuota).not.toHaveBeenCalled();
    expect(mockedRecordUsage).not.toHaveBeenCalled();
  });

  test("returns the quota status and reason when usage is rejected", async () => {
    mockedFindByIdempotencyKey.mockResolvedValue(null);
    mockedCheckQuota.mockResolvedValue({
      allowed: false,
      statusCode: 429,
      reason: "Token quota exceeded",
    });

    const response = await request(app)
      .post("/generate")
      .set("Authorization", "Bearer test-key")
      .set("Idempotency-Key", "request-1")
      .send({ outputTokens: 100 });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: "Token quota exceeded" });
    expect(mockedRecordUsage).not.toHaveBeenCalled();
  });
});

describe("GET /usage", () => {
  test("returns the current plan, usage breakdown, and cost", async () => {
    mockedGetPlanForTenant.mockResolvedValue({
      id: 1,
      name: "Starter",
      apiCallLimit: 10,
      aiTokenLimit: 1_000,
      priceCents: 1_500,
    });
    mockedSumUsageForCurrentPeriod.mockResolvedValue({
      apiCalls: 2,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 300,
      reasoningTokens: 40,
    });

    const response = await request(app)
      .get("/usage")
      .set("Authorization", "Bearer test-key");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      plan: "Starter",
      apiCalls: { used: 2, limit: 10 },
      tokens: {
        used: 460,
        limit: 1_000,
        breakdown: {
          input: 100,
          cachedInput: 20,
          output: 300,
          reasoning: 40,
        },
      },
      costCents: 2,
    });
  });

  test("returns 402 when no active subscription exists", async () => {
    mockedGetPlanForTenant.mockResolvedValue(null);

    const response = await request(app)
      .get("/usage")
      .set("Authorization", "Bearer test-key");

    expect(response.status).toBe(402);
    expect(response.body).toEqual({
      error: "No active subscription found for this tenant.",
    });
    expect(mockedSumUsageForCurrentPeriod).not.toHaveBeenCalled();
  });
});
