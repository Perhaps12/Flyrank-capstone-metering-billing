import { pool } from "../../../src/database/connection";
import { createTenant } from "../../../src/database/queries/tenants";
import {
  insertUsageEvent,
  findByIdempotencyKey,
  sumUsageForPeriod,
} from "../../../src/database/queries/usageEvents";

// These are integration tests — they run against the real Postgres
// instance (the Dockerized dev database), not a mock. A dedicated test
// tenant is created before each test and its usage_events are cleaned up
// after, so tests don't interfere with each other or leave junk data.

let testTenantId: number;

beforeEach(async () => {
  const tenant = await createTenant({
    name: `Test Tenant ${Date.now()}`,
    apiKey: `test_key_${Date.now()}_${Math.random()}`,
  });
  testTenantId = tenant.id;
});

afterEach(async () => {
  await pool.query(`DELETE FROM usage_events WHERE tenant_id = $1`, [testTenantId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [testTenantId]);
});

afterAll(async () => {
  await pool.end();
});

describe("insertUsageEvent + findByIdempotencyKey", () => {
  test("a new idempotency key inserts a row and can be found again", async () => {
    const inserted = await insertUsageEvent({
      tenantId: testTenantId,
      idempotencyKey: "key-1",
      apiCalls: 1,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 0,
    });

    expect(inserted.tenantId).toBe(testTenantId);
    expect(inserted.idempotencyKey).toBe("key-1");

    const found = await findByIdempotencyKey(testTenantId, "key-1");
    expect(found).not.toBeNull();
    expect(found?.id).toBe(inserted.id);
  });

  test("findByIdempotencyKey returns null for a key that doesn't exist", async () => {
    const found = await findByIdempotencyKey(testTenantId, "nonexistent-key");
    expect(found).toBeNull();
  });

  test("inserting the same (tenant_id, idempotency_key) twice violates the unique constraint", async () => {
    await insertUsageEvent({
      tenantId: testTenantId,
      idempotencyKey: "dup-key",
      apiCalls: 1,
      inputTokens: 50,
      cachedInputTokens: 0,
      outputTokens: 50,
      reasoningTokens: 0,
    });

    // Attempting the same key again should fail at the database level —
    // this is the actual enforcement mechanism for exactly-once metering.
    await expect(
      insertUsageEvent({
        tenantId: testTenantId,
        idempotencyKey: "dup-key",
        apiCalls: 1,
        inputTokens: 999,
        cachedInputTokens: 0,
        outputTokens: 999,
        reasoningTokens: 0,
      })
    ).rejects.toThrow();

    // Confirm only one row actually exists — no double-count occurred.
    const result = await pool.query(
      `SELECT count(*) FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2`,
      [testTenantId, "dup-key"]
    );
    expect(Number(result.rows[0].count)).toBe(1);
  });

  test("the same idempotency key is allowed for two different tenants", async () => {
    const otherTenant = await createTenant({
      name: `Other Tenant ${Date.now()}`,
      apiKey: `other_key_${Date.now()}_${Math.random()}`,
    });

    await insertUsageEvent({
      tenantId: testTenantId,
      idempotencyKey: "shared-key",
      apiCalls: 1,
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0,
    });

    // Should NOT throw — key scope is per-tenant, not global.
    await expect(
      insertUsageEvent({
        tenantId: otherTenant.id,
        idempotencyKey: "shared-key",
        apiCalls: 1,
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 10,
        reasoningTokens: 0,
      })
    ).resolves.not.toThrow();

    await pool.query(`DELETE FROM usage_events WHERE tenant_id = $1`, [otherTenant.id]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [otherTenant.id]);
  });
});

describe("sumUsageForPeriod", () => {
  test("sums multiple usage events correctly", async () => {
    await insertUsageEvent({
      tenantId: testTenantId,
      idempotencyKey: "sum-key-1",
      apiCalls: 1,
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 200,
      reasoningTokens: 5,
    });
    await insertUsageEvent({
      tenantId: testTenantId,
      idempotencyKey: "sum-key-2",
      apiCalls: 1,
      inputTokens: 50,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0,
    });

    const nowResult = await pool.query(`SELECT now() AS db_now`);
    const dbNow: Date = nowResult.rows[0].db_now;
    const since = new Date(dbNow.getTime() - 60_000); // 1 minute before db's own now, safely before both inserts
    const summary = await sumUsageForPeriod(testTenantId, since);

    expect(summary.apiCalls).toBe(2);
    expect(summary.inputTokens).toBe(150);
    expect(summary.cachedInputTokens).toBe(10);
    expect(summary.outputTokens).toBe(300);
    expect(summary.reasoningTokens).toBe(5);
  });

  test("returns all zeros for a tenant with no usage", async () => {
    const since = new Date(Date.now() - 60_000);
    const summary = await sumUsageForPeriod(testTenantId, since);

    expect(summary.apiCalls).toBe(0);
    expect(summary.inputTokens).toBe(0);
  });

  test("does not include usage from before the 'since' cutoff", async () => {
    await insertUsageEvent({
      tenantId: testTenantId,
      idempotencyKey: "old-key",
      apiCalls: 1,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0,
    });

    const nowResult = await pool.query(`SELECT now() AS db_now`);
    const dbNow: Date = nowResult.rows[0].db_now;
    const futureSince = new Date(dbNow.getTime() + 60_000);

    const summary = await sumUsageForPeriod(testTenantId, futureSince);

    expect(summary.apiCalls).toBe(0);
  });
});