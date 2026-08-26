import { pool } from "../connection";
import { createTenant } from "../queries/tenants";
import { createSubscription, getPlanByName } from "../queries/subscriptions";

// Creates a couple of test tenants with fixed, known api_key values so
// you have something concrete to test /generate and /usage against.
// Not a real signup flow — see DESIGN.md "auth" note. Safe to re-run;
// skips a tenant if one with that api_key already exists.
async function seedTenants() {
  const freePlan = await getPlanByName("free");
  const proPlan = await getPlanByName("pro");

  if (!freePlan || !proPlan) {
    throw new Error("Plans not found — run seed:plans first.");
  }

  const testTenants = [
    { name: "Acme Free Co", apiKey: "test_free_key_123", plan: freePlan },
    { name: "Acme Pro Co", apiKey: "test_pro_key_456", plan: proPlan },
  ];

  for (const t of testTenants) {
    const existing = await pool.query(
      `SELECT id FROM tenants WHERE api_key = $1`,
      [t.apiKey]
    );

    if (existing.rows.length > 0) {
      console.log(`Tenant "${t.name}" already exists, skipping.`);
      continue;
    }

    const tenant = await createTenant({ name: t.name, apiKey: t.apiKey });
    await createSubscription({ tenantId: tenant.id, planId: t.plan.id });
    console.log(`Created tenant "${t.name}" (id=${tenant.id}) on ${t.plan.name} plan`);
    console.log(`  api_key: ${t.apiKey}`);
  }

  await pool.end();
  console.log("Done.");
}

seedTenants().catch((err) => {
  console.error("Failed to seed tenants:", err);
  process.exit(1);
});