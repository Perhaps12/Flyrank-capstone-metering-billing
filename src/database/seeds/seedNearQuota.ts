import { pool } from "../connection";
import { findTenantByApiKey } from "../queries/tenants";
import { insertUsageEvent } from "../queries/usageEvents";

// Seeds usage for the Free test tenant (api_key: test_free_key_123) so
// it sits at 999/1000 API calls — one call away from its Free plan
// quota boundary. Useful for manually or automatically verifying:
//   - the 1000th call is allowed (projected == limit, not over it)
//   - the 1001st call is rejected with 429
//
// Inserted as a single usage_event with apiCalls=999 rather than 999
// separate rows — sumUsageForCurrentPeriod() sums the api_calls column,
// so one row with the right quantity is equivalent for quota-checking
// purposes and far faster to seed.
async function seedNearQuota() {
  const tenant = await findTenantByApiKey("test_free_key_123");

  if (!tenant) {
    throw new Error(
      "Test tenant with api_key 'test_free_key_123' not found — run seed:tenants first."
    );
  }

  await insertUsageEvent({
    tenantId: tenant.id,
    idempotencyKey: "seed-near-quota-boundary",
    apiCalls: 999,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  });

  console.log(`Tenant ${tenant.id} (test_free_key_123) now has 999/1000 API calls used.`);
  console.log("Next /generate call should be ALLOWED (reaches exactly 1000/1000).");
  console.log("The call after that should be REJECTED with 429.");

  await pool.end();
}

seedNearQuota().catch((err) => {
  console.error("Failed to seed near-quota usage:", err);
  process.exit(1);
});