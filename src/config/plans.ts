// Pinned plan quotas and subscription pricing.
// Pro is priced as a flat consumer subscription (anchored to ChatGPT Plus,
// USD $20/mo), not derived directly from metered per-call/per-token cost —
// see DESIGN.md "Pricing rationale" for the reasoning.
// Currency: USD throughout, for simplicity.

export type PlanName = "free" | "pro";

export interface Plan {
  name: PlanName;
  apiCallLimit: number;   // per billing period (monthly)
  aiTokenLimit: number;   // per billing period (monthly), all token categories combined
  priceCents: number;     // subscription price, USD cents
}

export const PLANS: Record<PlanName, Plan> = {
  free: {
    name: "free",
    apiCallLimit: 1_000,
    aiTokenLimit: 100_000,
    priceCents: 0,
  },
  pro: {
    name: "pro",
    apiCallLimit: 10_000,      // 10x Free
    aiTokenLimit: 1_000_000,   // 10x Free
    priceCents: 2_000,         // USD $20.00 / month
  },
};