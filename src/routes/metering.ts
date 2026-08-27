import { Router, Request, Response } from "express";
import { findByIdempotencyKey } from "../database/queries/usageEvents";
import { sumUsageForCurrentPeriod } from "../database/queries/usageEvents";
import { getPlanForTenant } from "../database/queries/subscriptions";
import { checkQuota } from "../domain/quotas";
import { recordUsage } from "../domain/metering";
import { calculateCost } from "../domain/pricing";

const router = Router();

interface GenerateBody {
  apiCalls?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

function parseGenerateBody(body: GenerateBody) {
  return {
    apiCalls: body.apiCalls ?? 1,
    inputTokens: body.inputTokens ?? 0,
    cachedInputTokens: body.cachedInputTokens ?? 0,
    outputTokens: body.outputTokens ?? 0,
    reasoningTokens: body.reasoningTokens ?? 0,
  };
}

function isValidUsageAmounts(amounts: ReturnType<typeof parseGenerateBody>) {
  return Object.values(amounts).every(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0
  );
}

// POST /generate — the dummy billable action. Simulates one AI call:
// records simulated token usage, checked against the tenant's quota.
//
// Order of operations matters here: duplicate requests are identified
// BEFORE running the quota check, not after. If a retried request ran
// through quota logic again, it would be added on top of usage that's
// already counted from the original request — incorrectly rejecting a
// legitimate retry for a tenant sitting near their limit. Checking for
// the duplicate first means a retry always returns the original result,
// regardless of current quota state.
router.post("/generate", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    // Should be unreachable if mockAuth is mounted correctly, but guards
    // against this route ever being wired up without it.
    return res.status(401).json({ error: "Unauthenticated" });
  }

  const idempotencyKey = req.header("Idempotency-Key");
  if (!idempotencyKey) {
    return res.status(400).json({ error: "Missing required Idempotency-Key header" });
  }

  const amounts = parseGenerateBody(req.body ?? {});
  if (!isValidUsageAmounts(amounts)) {
    return res.status(400).json({ error: "Usage amounts must be non-negative numbers" });
  }

  const existing = await findByIdempotencyKey(tenantId, idempotencyKey);

  if (existing) {
    const cost = calculateCost({
      inputTokens: existing.inputTokens,
      cachedInputTokens: existing.cachedInputTokens,
      outputTokens: existing.outputTokens,
      reasoningTokens: existing.reasoningTokens,
    });
    return res.status(200).json({
      usageEventId: existing.id,
      wasDuplicate: true,
      apiCalls: existing.apiCalls,
      inputTokens: existing.inputTokens,
      cachedInputTokens: existing.cachedInputTokens,
      outputTokens: existing.outputTokens,
      reasoningTokens: existing.reasoningTokens,
      costCents: cost.totalCostCents,
      createdAt: existing.createdAt,
    });
  }

  const requestedTokens =
    amounts.inputTokens +
    amounts.cachedInputTokens +
    amounts.outputTokens +
    amounts.reasoningTokens;

  const quota = await checkQuota({
    tenantId,
    requestedApiCalls: amounts.apiCalls,
    requestedTokens,
  });

  if (!quota.allowed) {
    return res.status(quota.statusCode).json({ error: quota.reason });
  }

  const result = await recordUsage({
    tenantId,
    idempotencyKey,
    ...amounts,
  });

  const cost = calculateCost({
    inputTokens: result.inputTokens,
    cachedInputTokens: result.cachedInputTokens,
    outputTokens: result.outputTokens,
    reasoningTokens: result.reasoningTokens,
  });

  return res.status(201).json({
    usageEventId: result.usageEventId,
    wasDuplicate: result.wasDuplicate,
    apiCalls: result.apiCalls,
    inputTokens: result.inputTokens,
    cachedInputTokens: result.cachedInputTokens,
    outputTokens: result.outputTokens,
    reasoningTokens: result.reasoningTokens,
    costCents: cost.totalCostCents,
    createdAt: result.createdAt,
  });
});

// GET /usage — read-only rollup: current period usage against plan
// limits, plus the cost that usage represents.
router.get("/usage", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: "Unauthenticated" });
  }

  const plan = await getPlanForTenant(tenantId);
  if (!plan) {
    return res.status(402).json({ error: "No active subscription found for this tenant." });
  }

  const usage = await sumUsageForCurrentPeriod(tenantId);
  const cost = calculateCost({
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
  });

  const totalTokens =
    usage.inputTokens +
    usage.cachedInputTokens +
    usage.outputTokens +
    usage.reasoningTokens;

  return res.status(200).json({
    plan: plan.name,
    apiCalls: {
      used: usage.apiCalls,
      limit: plan.apiCallLimit,
    },
    tokens: {
      used: totalTokens,
      limit: plan.aiTokenLimit,
      breakdown: {
        input: usage.inputTokens,
        cachedInput: usage.cachedInputTokens,
        output: usage.outputTokens,
        reasoning: usage.reasoningTokens,
      },
    },
    costCents: cost.totalCostCents,
  });
});

export default router;