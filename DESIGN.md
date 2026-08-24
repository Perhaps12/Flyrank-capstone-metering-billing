# FILE STRUCTURE

```
src/
  routes/
    meta.ts                # health check / basic docs
    billing.ts             # POST /billing/checkout - starts a Stripe subscription
    webhooks.ts            # POST /webhooks/stripe - receives Stripe events
    metering.ts            # POST /generate, GET /usage - handles call/token usage

  domain/
    metering.ts            # records a usage event, enforces idempotency
    quotas.ts              # checks usage vs plan limit, returns 429/402
    pricing.ts             # token cost calculation (cached/reasoning rules)

  services/
    stripe.ts              # Stripe SDK calls: create checkout session, verify signature

  database/
    connection.ts          # Postgres connection setup
    migrations/            # versioned schema changes
    queries/
        tenants.ts         # getTenantByApiKey, createTenant
        usageEvents.ts     # insertUsageEvent, sumUsageForTenant, findByIdempotencyKey
        subscriptions.ts   # updateTenantPlan, getSubscriptionByStripeCustomerId
        webhookEvents.ts   # hasProcessedEvent, markEventProcessed

  middleware/
    mockAuth.ts            # resolves tenant from api_key header

  config/
    pricing.ts             # pinned token pricing constants
    plans.ts               # Free/Pro quota + price values

  app.ts                   # route registration / app setup
  index.ts                 # server entrypoint

docker-compose.yml         
.env.example               
README.md
capstone.yaml
EVIDENCE.md
BUILDLOG.md
```

# DATABASE SCHEMA

```sql
-- ============================================
-- TENANTS — customer identity + mock auth credential
-- ============================================
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  public_id UUID DEFAULT gen_random_uuid() UNIQUE,   -- safe external reference, if ever needed
  api_key TEXT UNIQUE NOT NULL,                       -- mock auth credential, resolved by middleware
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- ============================================
-- PLANS — Free / Pro, quota + price constants
-- ============================================
CREATE TABLE plans (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,          -- 'free' | 'pro'
  api_call_limit INT NOT NULL,        -- e.g. 1000 for free
  ai_token_limit INT NOT NULL,        -- e.g. 100000 for free
  price_cents INT NOT NULL            -- 0 for free, e.g. 2900 for pro
);

-- ============================================
-- SUBSCRIPTIONS — which plan a tenant currently has, Stripe linkage
-- ============================================
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  plan_id INT NOT NULL REFERENCES plans(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | canceled | past_due, etc.
  updated_at TIMESTAMP DEFAULT now()
);

-- ============================================
-- USAGE_EVENTS — the metering log (/generate calls)
-- ============================================
CREATE TABLE usage_events (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  api_calls INT NOT NULL DEFAULT 1,
  input_tokens INT NOT NULL DEFAULT 0,
  cached_input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  reasoning_tokens INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

-- ============================================
-- PROCESSED_WEBHOOK_EVENTS — Stripe webhook dedup
-- ============================================
CREATE TABLE processed_webhook_events (
  id SERIAL PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  processed_at TIMESTAMP DEFAULT now()
);
```

# CORE FUNCTIONS

Scope: the functions in `domain/` and the webhook handling flow handles most of the logic of the site, everything else is relatively simple.

Note on auth: `mockAuth.ts` exists only to simulate that some
form of authentication has happened, standing in for a real system. It
resolves the `api_key` header into a `tenant_id` *before* any domain
function is called. Domain functions only ever receive a resolved `tenant_id`. 

---

## `domain/metering.ts`

### `recordUsage(params): UsageResult`

```ts
type RecordUsageParams = {
  tenantId: number;
  idempotencyKey: string;
  apiCalls: number;              // usually 1
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

type UsageResult = {
  usageEventId: number;
  wasDuplicate: boolean;         // true if this key was already seen
  apiCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  createdAt: string;
};
```

**Behavior:** attempts to insert a `usage_events` row. If `(tenantId,
idempotencyKey)` already exists, fetches and returns the original row
instead of inserting a new one

---

## `domain/quotas.ts`

### `checkQuota(params): QuotaCheckResult`

```ts
type CheckQuotaParams = {
  tenantId: number;
  requestedApiCalls: number;
  requestedTokens: number;       // sum of all token categories being requested
};

type QuotaCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      statusCode: 429 | 402;
      reason: string;            // human-readable explanation returned to the caller
    };
```

**Behavior:** sums the tenant's `usage_events` for the current billing
period, adds the requested amount, compares against the tenant's plan limit
(via their `subscriptions` → `plans` row). Returns `429` if usage quota is
exceeded on an otherwise-valid plan; `402` if the plan/subscription itself
doesn't permit the action (e.g. lapsed).

---

## `domain/pricing.ts`

### `calculateCost(params): CostBreakdown`

```ts
type CalculateCostParams = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

type CostBreakdown = {
  inputCostCents: number;
  cachedInputCostCents: number;
  outputCostCents: number;       // includes reasoning tokens, priced as output
  totalCostCents: number;
};
```

**Behavior:** pure function, no database access. Applies the pinned rates
from `config/pricing.ts` — cached input priced lower than fresh input,
reasoning tokens folded into the output rate, categories never simply
summed before pricing is applied.

---

## Webhook flow (`routes/webhooks.ts` → `services/stripe.ts` + `domain/`)

### `verifyStripeSignature(params): StripeEvent`

```ts
type VerifySignatureParams = {
  rawBody: Buffer;               // unparsed request body — required for verification
  signatureHeader: string;       // Stripe-Signature header value
};

// throws if invalid — caller responds 400 and stops
type StripeEvent = {
  id: string;                    // e.g. "evt_1Abc..."
  type: string;                  // e.g. "checkout.session.completed"
  data: Record<string, unknown>;
};
```

### `handleWebhookEvent(event: StripeEvent): WebhookResult`

```ts
type WebhookResult =
  | { status: "ignored_duplicate" }
  | { status: "processed"; tenantId: number; newPlan: string };
```

**Behavior:**
1. Check `processed_webhook_events` for `event.id` — if present, return
   `{ status: "ignored_duplicate" }` without touching `subscriptions`.
2. If new: resolve the `tenantId` (via `client_reference_id` or a stored
   `stripe_customer_id` lookup), apply the plan/status change to
   `subscriptions`, insert `event.id` into `processed_webhook_events`.

