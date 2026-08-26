import { TOKEN_PRICING_CENTS_PER_MILLION as RATES } from "../config/pricing";

export interface CalculateCostParams {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface CostBreakdown {
  inputCostCents: number;
  cachedInputCostCents: number;
  outputCostCents: number; // includes reasoning tokens, priced as output
  totalCostCents: number;
}

// Pure function — no database access, so this is trivial to pin exact
// test cases against. Applies the pricing rules from config/pricing.ts:
// cached input is cheaper than fresh input, reasoning tokens are billed
// at the output rate (not a separate rate), and categories are priced
// independently before being summed — never blended into one flat rate.
export function calculateCost(params: CalculateCostParams): CostBreakdown {
  const inputCostCents = Math.round(
    (params.inputTokens * RATES.input) / 1_000_000
  );
  const cachedInputCostCents = Math.round(
    (params.cachedInputTokens * RATES.cachedInput) / 1_000_000
  );

  // Reasoning tokens are folded into the output token count before
  // pricing — this is the "reasoning counts as output" rule, applied
  // here rather than left as an easy-to-miss detail in the caller.
  const billableOutputTokens = params.outputTokens + params.reasoningTokens;
  const outputCostCents = Math.round(
    (billableOutputTokens * RATES.output) / 1_000_000
  );

  return {
    inputCostCents,
    cachedInputCostCents,
    outputCostCents,
    totalCostCents: inputCostCents + cachedInputCostCents + outputCostCents,
  };
}