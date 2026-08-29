import { pool } from "../../../src/database/connection";
import {
  findByIdempotencyKey,
  insertUsageEvent,
  sumUsageForCurrentPeriod,
  sumUsageForPeriod,
} from "../../../src/database/queries/usageEvents";

jest.mock("../../../src/database/connection", () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockedQuery = jest.mocked(pool.query);

const usageRow = {
  id: 42,
  tenant_id: 7,
  idempotency_key: "key-1",
  api_calls: 1,
  input_tokens: 100,
  cached_input_tokens: 10,
  output_tokens: 200,
  reasoning_tokens: 5,
  created_at: "2026-08-26T12:00:00.000Z",
};

const usageSummaryRow = {
  api_calls: 2,
  input_tokens: 150,
  cached_input_tokens: 10,
  output_tokens: 300,
  reasoning_tokens: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("insertUsageEvent + findByIdempotencyKey", () => {
  test("maps an inserted database row to a usage event", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [usageRow] } as never);

    await expect(
      insertUsageEvent({
        tenantId: 7,
        idempotencyKey: "key-1",
        apiCalls: 1,
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 200,
        reasoningTokens: 5,
      })
    ).resolves.toEqual({
      id: 42,
      tenantId: 7,
      idempotencyKey: "key-1",
      apiCalls: 1,
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 200,
      reasoningTokens: 5,
      createdAt: "2026-08-26T12:00:00.000Z",
    });

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO usage_events"),
      [7, "key-1", 1, 100, 10, 200, 5]
    );
  });

  test("finds and maps an existing event by tenant and idempotency key", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [usageRow] } as never);

    await expect(findByIdempotencyKey(7, "key-1")).resolves.toEqual({
      id: 42,
      tenantId: 7,
      idempotencyKey: "key-1",
      apiCalls: 1,
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 200,
      reasoningTokens: 5,
      createdAt: "2026-08-26T12:00:00.000Z",
    });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = $1 AND idempotency_key = $2"),
      [7, "key-1"]
    );
  });

  test("returns null when an idempotency key does not exist", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

    await expect(findByIdempotencyKey(7, "missing-key")).resolves.toBeNull();
  });

  test("propagates a database unique-constraint error", async () => {
    const error = Object.assign(new Error("duplicate key"), { code: "23505" });
    mockedQuery.mockImplementationOnce(() => Promise.reject(error));

    await expect(
      insertUsageEvent({
        tenantId: 7,
        idempotencyKey: "duplicate-key",
        apiCalls: 1,
        inputTokens: 50,
        cachedInputTokens: 0,
        outputTokens: 50,
        reasoningTokens: 0,
      })
    ).rejects.toBe(error);
  });
});

describe("usage summaries", () => {
  test("maps the current-period aggregate returned by the database", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [usageSummaryRow] } as never);

    await expect(sumUsageForCurrentPeriod(7)).resolves.toEqual({
      apiCalls: 2,
      inputTokens: 150,
      cachedInputTokens: 10,
      outputTokens: 300,
      reasoningTokens: 5,
    });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("date_trunc('month', now())"),
      [7]
    );
  });

  test("returns zero totals for an empty aggregate", async () => {
    const since = new Date("2026-08-01T00:00:00.000Z");
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          api_calls: 0,
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
        },
      ],
    } as never);

    await expect(sumUsageForPeriod(7, since)).resolves.toEqual({
      apiCalls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("created_at >= $2"),
      [7, since]
    );
  });

  test("passes the tenant and cutoff to a period aggregate query", async () => {
    const since = new Date("2026-08-01T00:00:00.000Z");
    mockedQuery.mockResolvedValueOnce({ rows: [usageSummaryRow] } as never);

    await sumUsageForPeriod(7, since);

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = $1 AND created_at >= $2"),
      [7, since]
    );
  });
});