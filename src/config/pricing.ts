// Pinned AI token pricing constants.
// Rates are cents per MILLION tokens (integers) to avoid floating point
//
// Target: ~$3 USD per 100k tokens of typical mixed usage (~30% input / 70% output) → ~$30/M blended.
// See DESIGN.md "PRICING RATIONALE" for reasoning.
// Currency: USD throughout, for simplicity.
//
// Rules encoded elsewhere (domain/pricing.ts), constants only here:
//   - cached input tokens are cheaper than fresh input tokens
//   - reasoning tokens are billed at the OUTPUT rate, not a separate rate
//   - categories are priced independently, then summed — never blended
//     into one flat per-token rate before pricing
 
export const TOKEN_PRICING_CENTS_PER_MILLION = {
  input: 1_000,         // USD $15.00 / 1M input tokens
  cachedInput: 500,      // USD $7.50 / 1M cached input tokens (50% of input rate)
  output: 2_300,         // USD $35.00 / 1M output tokens
  // reasoning tokens intentionally have no separate rate here —
  // domain/pricing.ts must price them using `output`, per the pricing rule.
} as const;