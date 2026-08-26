import { pool } from "../connection";

export interface UsageEvent {
  id: number;
  tenantId: number;
  idempotencyKey: string;
  apiCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  createdAt: string;
}

function mapRow(row: any): UsageEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    idempotencyKey: row.idempotency_key,
    apiCalls: row.api_calls,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    createdAt: row.created_at,
  };
}

// Looked up first on every /generate call, before inserting anything
export async function findByIdempotencyKey(
  tenantId: number,
  idempotencyKey: string
): Promise<UsageEvent | null> {
  const result = await pool.query(
    `SELECT id, tenant_id, idempotency_key, api_calls, input_tokens,
            cached_input_tokens, output_tokens, reasoning_tokens, created_at
     FROM usage_events
     WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, idempotencyKey]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// Inserts a new usage event. Relies on the UNIQUE (tenant_id, idempotency_key)
// constraint along with idempotency checks by caller functions to avoid double-counting
export async function insertUsageEvent(params: {
  tenantId: number;
  idempotencyKey: string;
  apiCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}): Promise<UsageEvent> {
  const result = await pool.query(
    `INSERT INTO usage_events
       (tenant_id, idempotency_key, api_calls, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, tenant_id, idempotency_key, api_calls, input_tokens,
               cached_input_tokens, output_tokens, reasoning_tokens, created_at`,
    [
      params.tenantId,
      params.idempotencyKey,
      params.apiCalls,
      params.inputTokens,
      params.cachedInputTokens,
      params.outputTokens,
      params.reasoningTokens,
    ]
  );
  return mapRow(result.rows[0]);
}

export interface UsageSummary {
  apiCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

// Sums all usage for a tenant since a given timestamp (usually the start of the billing period))
export async function sumUsageForPeriod(
  tenantId: number,
  since: Date
): Promise<UsageSummary> {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(api_calls), 0)::int AS api_calls,
       COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
       COALESCE(SUM(cached_input_tokens), 0)::int AS cached_input_tokens,
       COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
       COALESCE(SUM(reasoning_tokens), 0)::int AS reasoning_tokens
     FROM usage_events
     WHERE tenant_id = $1 AND created_at >= $2`,
    [tenantId, since]
  );
  const row = result.rows[0];
  return {
    apiCalls: row.api_calls,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
  };
}