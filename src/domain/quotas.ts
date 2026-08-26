import { getPlanForTenant } from "../database/queries/subscriptions";
import { sumUsageForCurrentPeriod } from "../database/queries/usageEvents";

export interface CheckQuotaParams {
  tenantId: number;
  requestedApiCalls: number;
  requestedTokens: number; // sum across all token categories being requested
}

export type QuotaCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      statusCode: 429 | 402;
      reason: string;
    };

// Decides whether a request is allowed under the tenant's current plan.
// Sums real usage from the event log (never a cached balance) and adds
// the requested amount, comparing against the plan's limits.
//
// 402 = the tenant has no valid/active plan to check against at all.
// 429 = the tenant has a valid plan, but this request would exceed its
//       usage limit for the current period.
export async function checkQuota(
  params: CheckQuotaParams
): Promise<QuotaCheckResult> {
  const plan = await getPlanForTenant(params.tenantId);

  if (!plan) {
    return {
      allowed: false,
      statusCode: 402,
      reason: "No active subscription found for this tenant.",
    };
  }

  const currentUsage = await sumUsageForCurrentPeriod(params.tenantId);

  const projectedApiCalls = currentUsage.apiCalls + params.requestedApiCalls;
  const currentTokens =
    currentUsage.inputTokens +
    currentUsage.cachedInputTokens +
    currentUsage.outputTokens +
    currentUsage.reasoningTokens;
  const projectedTokens = currentTokens + params.requestedTokens;

  if (projectedApiCalls > plan.apiCallLimit) {
    return {
      allowed: false,
      statusCode: 429,
      reason: `API call quota exceeded: ${projectedApiCalls}/${plan.apiCallLimit} for the ${plan.name} plan this period.`,
    };
  }

  if (projectedTokens > plan.aiTokenLimit) {
    return {
      allowed: false,
      statusCode: 429,
      reason: `Token quota exceeded: ${projectedTokens}/${plan.aiTokenLimit} for the ${plan.name} plan this period.`,
    };
  }

  return { allowed: true };
}