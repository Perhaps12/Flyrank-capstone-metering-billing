import { getPlanForTenant } from "../../src/database/queries/subscriptions";
import {
  findByIdempotencyKey,
  insertUsageEvent,
  UsageEvent,
} from "../../src/database/queries/usageEvents";
import { recordUsage } from "../../src/domain/metering";
import { calculateCost } from "../../src/domain/pricing";
import { checkQuota } from "../../src/domain/quotas";
import { sumUsageForCurrentPeriod } from "../../src/database/queries/usageEvents";

jest.mock("../../src/database/queries/subscriptions", () => ({
  getPlanForTenant: jest.fn(),
}));

jest.mock("../../src/database/queries/usageEvents", () => ({
  findByIdempotencyKey: jest.fn(),
  insertUsageEvent: jest.fn(),
  sumUsageForCurrentPeriod: jest.fn(),
}));

const mockedGetPlanForTenant = jest.mocked(getPlanForTenant);
const mockedFindByIdempotencyKey = jest.mocked(findByIdempotencyKey);
const mockedInsertUsageEvent = jest.mocked(insertUsageEvent);
const mockedSumUsageForCurrentPeriod = jest.mocked(sumUsageForCurrentPeriod);

const usageEvent: UsageEvent = {
  id: 42,
  tenantId: 7,
  idempotencyKey: "request-1",
  apiCalls: 2,
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 300,
  reasoningTokens: 40,
  createdAt: "2026-08-26T12:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("calculateCost", () => {
  test("prices each token category and includes reasoning at the output rate", () => {
    expect(
      calculateCost({
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 1_000_000,
        reasoningTokens: 500_000,
      })
    ).toEqual({
      inputCostCents: 1_000,
      cachedInputCostCents: 50,
      outputCostCents: 3_450,
      totalCostCents: 4_500,
    });
  });

  test("rounds each category independently before summing", () => {
    expect(
      calculateCost({
        inputTokens: 500,
        cachedInputTokens: 500,
        outputTokens: 500,
        reasoningTokens: 0,
      })
    ).toEqual({
      inputCostCents: 1,
      cachedInputCostCents: 0,
      outputCostCents: 1,
      totalCostCents: 2,
    });
  });
});

describe("recordUsage", () => {
  test("inserts a new event and marks it as not duplicated", async () => {
    mockedFindByIdempotencyKey.mockResolvedValue(null);
    mockedInsertUsageEvent.mockResolvedValue(usageEvent);

    await expect(
      recordUsage({
        tenantId: usageEvent.tenantId,
        idempotencyKey: usageEvent.idempotencyKey,
        apiCalls: usageEvent.apiCalls,
        inputTokens: usageEvent.inputTokens,
        cachedInputTokens: usageEvent.cachedInputTokens,
        outputTokens: usageEvent.outputTokens,
        reasoningTokens: usageEvent.reasoningTokens,
      })
    ).resolves.toEqual({
      tenantId: usageEvent.tenantId,
      idempotencyKey: usageEvent.idempotencyKey,
      apiCalls: usageEvent.apiCalls,
      inputTokens: usageEvent.inputTokens,
      cachedInputTokens: usageEvent.cachedInputTokens,
      outputTokens: usageEvent.outputTokens,
      reasoningTokens: usageEvent.reasoningTokens,
      createdAt: usageEvent.createdAt,
      usageEventId: usageEvent.id,
      wasDuplicate: false,
    });
    expect(mockedInsertUsageEvent).toHaveBeenCalledTimes(1);
  });

  test("returns the original event without inserting for a duplicate", async () => {
    mockedFindByIdempotencyKey.mockResolvedValue(usageEvent);

    await expect(
      recordUsage({
        tenantId: usageEvent.tenantId,
        idempotencyKey: usageEvent.idempotencyKey,
        apiCalls: 999,
        inputTokens: 999,
        cachedInputTokens: 999,
        outputTokens: 999,
        reasoningTokens: 999,
      })
    ).resolves.toMatchObject({
      usageEventId: usageEvent.id,
      apiCalls: usageEvent.apiCalls,
      wasDuplicate: true,
    });
    expect(mockedInsertUsageEvent).not.toHaveBeenCalled();
  });

  test("recovers from a unique violation by returning the race winner", async () => {
    mockedFindByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(usageEvent);
    mockedInsertUsageEvent.mockRejectedValue({ code: "23505" });

    await expect(
      recordUsage({
        tenantId: usageEvent.tenantId,
        idempotencyKey: usageEvent.idempotencyKey,
        apiCalls: usageEvent.apiCalls,
        inputTokens: usageEvent.inputTokens,
        cachedInputTokens: usageEvent.cachedInputTokens,
        outputTokens: usageEvent.outputTokens,
        reasoningTokens: usageEvent.reasoningTokens,
      })
    ).resolves.toMatchObject({ usageEventId: usageEvent.id, wasDuplicate: true });
  });

  test("rethrows non-unique insert errors", async () => {
    const error = new Error("database unavailable");
    mockedFindByIdempotencyKey.mockResolvedValue(null);
    mockedInsertUsageEvent.mockRejectedValue(error);

    await expect(
      recordUsage({
        tenantId: usageEvent.tenantId,
        idempotencyKey: usageEvent.idempotencyKey,
        apiCalls: 1,
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
      })
    ).rejects.toBe(error);
  });
});

describe("checkQuota", () => {
  const plan = {
    id: 1,
    name: "Starter",
    apiCallLimit: 10,
    aiTokenLimit: 1_000,
    priceCents: 1_500,
  };
  const currentUsage = {
    apiCalls: 3,
    inputTokens: 100,
    cachedInputTokens: 50,
    outputTokens: 200,
    reasoningTokens: 50,
  };

  test("allows a request within both quotas", async () => {
    mockedGetPlanForTenant.mockResolvedValue(plan);
    mockedSumUsageForCurrentPeriod.mockResolvedValue(currentUsage);

    await expect(
      checkQuota({ tenantId: 7, requestedApiCalls: 2, requestedTokens: 300 })
    ).resolves.toEqual({ allowed: true });
  });

  test("returns 402 when the tenant has no plan", async () => {
    mockedGetPlanForTenant.mockResolvedValue(null);

    await expect(
      checkQuota({ tenantId: 7, requestedApiCalls: 1, requestedTokens: 1 })
    ).resolves.toEqual({
      allowed: false,
      statusCode: 402,
      reason: "No active subscription found for this tenant.",
    });
    expect(mockedSumUsageForCurrentPeriod).not.toHaveBeenCalled();
  });

  test("returns 429 when projected API calls exceed the plan", async () => {
    mockedGetPlanForTenant.mockResolvedValue(plan);
    mockedSumUsageForCurrentPeriod.mockResolvedValue(currentUsage);

    await expect(
      checkQuota({ tenantId: 7, requestedApiCalls: 8, requestedTokens: 0 })
    ).resolves.toEqual({
      allowed: false,
      statusCode: 429,
      reason: "API call quota exceeded: 11/10 for the Starter plan this period.",
    });
  });

  test("returns 429 when projected tokens exceed the plan", async () => {
    mockedGetPlanForTenant.mockResolvedValue(plan);
    mockedSumUsageForCurrentPeriod.mockResolvedValue(currentUsage);

    await expect(
      checkQuota({ tenantId: 7, requestedApiCalls: 0, requestedTokens: 601 })
    ).resolves.toEqual({
      allowed: false,
      statusCode: 429,
      reason: "Token quota exceeded: 1001/1000 for the Starter plan this period.",
    });
  });
});