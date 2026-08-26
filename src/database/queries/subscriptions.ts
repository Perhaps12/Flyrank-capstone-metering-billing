import { pool } from "../connection";

export interface Plan {
  id: number;
  name: string;
  apiCallLimit: number;
  aiTokenLimit: number;
  priceCents: number;
}

export interface Subscription {
  id: number;
  tenantId: number;
  planId: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string;
  updatedAt: string;
}

function mapPlanRow(row: any): Plan {
  return {
    id: row.id,
    name: row.name,
    apiCallLimit: row.api_call_limit,
    aiTokenLimit: row.ai_token_limit,
    priceCents: row.price_cents,
  };
}

function mapSubscriptionRow(row: any): Subscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planId: row.plan_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

// Returns the plan currently active for a tenant
export async function getPlanForTenant(tenantId: number): Promise<Plan | null> {
  const result = await pool.query(
    `SELECT p.id, p.name, p.api_call_limit, p.ai_token_limit, p.price_cents
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0] ? mapPlanRow(result.rows[0]) : null;
}

export async function getSubscriptionForTenant(
  tenantId: number
): Promise<Subscription | null> {
  const result = await pool.query(
    `SELECT id, tenant_id, plan_id, stripe_customer_id, stripe_subscription_id, status, updated_at
     FROM subscriptions
     WHERE tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0] ? mapSubscriptionRow(result.rows[0]) : null;
}

// Used by the webhook handler to resolve which tenant a Stripe event
// belongs to, when the event only carries the Stripe customer id.
export async function findTenantIdByStripeCustomerId(
  stripeCustomerId: string
): Promise<number | null> {
  const result = await pool.query(
    `SELECT tenant_id FROM subscriptions WHERE stripe_customer_id = $1`,
    [stripeCustomerId]
  );
  return result.rows[0]?.tenant_id ?? null;
}

// Called once, when a tenant is first set up (e.g. by a seed script) —
// creates their initial subscription row, typically on the Free plan.
export async function createSubscription(params: {
  tenantId: number;
  planId: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status?: string;
}): Promise<Subscription> {
  const result = await pool.query(
    `INSERT INTO subscriptions (tenant_id, plan_id, stripe_customer_id, stripe_subscription_id, status)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'active'))
     RETURNING id, tenant_id, plan_id, stripe_customer_id, stripe_subscription_id, status, updated_at`,
    [
      params.tenantId,
      params.planId,
      params.stripeCustomerId ?? null,
      params.stripeSubscriptionId ?? null,
      params.status ?? null,
    ]
  );
  return mapSubscriptionRow(result.rows[0]);
}

// Applies a plan/status change from a verified webhook event. Updates
// in place — this project keeps one subscription row per tenant rather
// than an append-only history (see DESIGN.md for that tradeoff).
export async function updateTenantPlan(params: {
  tenantId: number;
  planId: number;
  status: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}): Promise<Subscription> {
  const result = await pool.query(
    `UPDATE subscriptions
     SET plan_id = $2,
         status = $3,
         stripe_customer_id = COALESCE($4, stripe_customer_id),
         stripe_subscription_id = COALESCE($5, stripe_subscription_id),
         updated_at = now()
     WHERE tenant_id = $1
     RETURNING id, tenant_id, plan_id, stripe_customer_id, stripe_subscription_id, status, updated_at`,
    [
      params.tenantId,
      params.planId,
      params.status,
      params.stripeCustomerId ?? null,
      params.stripeSubscriptionId ?? null,
    ]
  );
  return mapSubscriptionRow(result.rows[0]);
}

export async function getPlanByName(name: string): Promise<Plan | null> {
  const result = await pool.query(
    `SELECT id, name, api_call_limit, ai_token_limit, price_cents
     FROM plans
     WHERE name = $1`,
    [name]
  );
  return result.rows[0] ? mapPlanRow(result.rows[0]) : null;
}