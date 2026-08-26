import {
  findByIdempotencyKey,
  insertUsageEvent,
  UsageEvent,
} from "../database/queries/usageEvents";

export interface RecordUsageParams {
  tenantId: number;
  idempotencyKey: string;
  apiCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface UsageResult extends Omit<UsageEvent, "id"> {
  usageEventId: number;
  wasDuplicate: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres error code 23505 = unique_violation.
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

function toResult(event: UsageEvent, wasDuplicate: boolean): UsageResult {
  return {
    tenantId: event.tenantId,
    idempotencyKey: event.idempotencyKey,
    apiCalls: event.apiCalls,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    outputTokens: event.outputTokens,
    reasoningTokens: event.reasoningTokens,
    createdAt: event.createdAt,
    usageEventId: event.id,
    wasDuplicate,
  };
}

// Records a usage event exactly once per (tenantId, idempotencyKey).
// A retried request with the same key returns the ORIGINAL stored
// result — no new row, no re-calculation — so the response is identical
// whether this is the first attempt or the fifth retry.
//
// The UNIQUE (tenant_id, idempotency_key) constraint on usage_events is
// the actual enforcement backstop: even if two concurrent requests both
// pass the initial findByIdempotencyKey check (a genuine race), only one
// insert can succeed. The catch block below handles that race by
// re-fetching the row the other request just inserted, rather than
// erroring out or double-charging.
export async function recordUsage(
  params: RecordUsageParams
): Promise<UsageResult> {
  const existing = await findByIdempotencyKey(
    params.tenantId,
    params.idempotencyKey
  );
  if (existing) {
    return toResult(existing, true);
  }

  try {
    const inserted = await insertUsageEvent(params);
    return toResult(inserted, false);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raceWinner = await findByIdempotencyKey(
        params.tenantId,
        params.idempotencyKey
      );
      if (raceWinner) {
        return toResult(raceWinner, true);
      }
    }
    throw err;
  }
}