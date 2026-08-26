import { pool } from "../connection";
import { PLANS } from "../../config/plans";

// Seeds the plans table from the pinned constants in config/plans.ts.
// Safe to re-run: upserts on `name` rather than inserting duplicates,
// so limits/pricing changes in config just need a re-run of this script.
async function seedPlans() {
  for (const plan of Object.values(PLANS)) {
    await pool.query(
      `INSERT INTO plans (name, api_call_limit, ai_token_limit, price_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE
       SET api_call_limit = EXCLUDED.api_call_limit,
           ai_token_limit = EXCLUDED.ai_token_limit,
           price_cents = EXCLUDED.price_cents`,
      [plan.name, plan.apiCallLimit, plan.aiTokenLimit, plan.priceCents]
    );
    console.log(`Seeded plan: ${plan.name}`);
  }

  await pool.end();
  console.log("Done.");
}

seedPlans().catch((err) => {
  console.error("Failed to seed plans:", err);
  process.exit(1);
});