# Usage Metering & Billing Engine

A backend service that answers the three questions every SaaS product needs
answered: how much has this customer used, what does it cost, and have they
hit their plan's limit? It meters simulated API/token usage per tenant,
enforces Free/Pro quota limits, calculates AI-token costs with real-world
pricing rules (cached input, reasoning tokens), and syncs subscription state
with Stripe test-mode webhooks — correctly, even under retries and duplicate
event delivery. Multi-tenant throughout, with usage stored as an
append-only event log rather than a mutable balance, so idempotency can be
enforced by the database itself rather than trusted to application code.

## Authentication

Real authentication (signup, sessions) is an explicit non-goal for this
project. A mock auth layer (`middleware/mockAuth.ts`) simulates the result
of authentication instead: each request sends a static `api_key` as a
Bearer token, which is resolved to a `tenant_id` before reaching any route.

## Architecture

Three main  flows: recording usage, reading usage back, and syncing plan
state from Stripe. All routes pass through auth first; the two systems
meet only at `subscriptions`, which `/generate` and `/usage` read from
and Stripe webhooks write to.

### 1. Recording usage — `POST /generate`

```
CLIENT
  |  POST /generate  (Authorization: Bearer <api_key>, Idempotency-Key)
  v
src/middleware/mockAuth.ts        resolves api_key → tenant_id
  v
src/routes/metering.ts
  v
src/domain/metering.ts            recordUsage()
  |   checks (tenant_id, idempotency_key) via
  |   src/database/queries/usageEvents.ts
  v
src/domain/quotas.ts              checkQuota()
  |   sums usage via src/database/queries/usageEvents.ts
  |   compares against src/database/queries/subscriptions.ts
  v
src/database/queries/usageEvents.ts   INSERT usage_events row
  v
src/domain/pricing.ts             calculateCost()
  v
CLIENT  <-- usageEventId, wasDuplicate, costCents
```

### 2. Reading usage back — `GET /usage`

```
CLIENT
  |  GET /usage  (Authorization: Bearer <api_key>)
  v
src/middleware/mockAuth.ts
  v
src/routes/metering.ts
  v
src/database/queries/subscriptions.ts   getPlanForTenant()
src/database/queries/usageEvents.ts     sumUsageForCurrentPeriod()
  v
src/domain/pricing.ts             calculateCost()
  v
CLIENT  <-- { plan, apiCalls, tokens, costCents }
```

### 3. Syncing plan state — Stripe checkout & webhook

```
CLIENT (browser)
  |  POST /billing/checkout
  v
src/routes/billing.ts
  v
src/services/stripe.ts            createCheckoutSession()
  v
Stripe Checkout (hosted page) ── customer pays --> Stripe

Stripe
  |  webhook: POST /webhooks/stripe
  v
src/routes/webhooks.ts
  v
src/services/stripe.ts            verifyStripeSignature()
  |   forged signature → 400, stop here
  v
src/domain/billing.ts             handleWebhookEvent()
  |   dedupes via src/database/queries/webhookEvents.ts
  |   resolves tenant via src/database/queries/subscriptions.ts
  v
src/database/queries/subscriptions.ts   updateTenantPlan()
  v
subscriptions table updated (tenant → new plan)
```

## Setup & Run

**1. Install dependencies**
```cmd
npm install
```

**2. Configure environment**

Copy `.env.example` to `.env` and fill in real values for:
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (from your Stripe dashboard, test mode)
- `STRIPE_PRICE_ID_PRO` (the Pro product's Price ID you created)
- `APP_BASE_URL` (default `http://localhost:3000` is fine locally)
- `DATABASE_URL=postgres://postgres:postgres@localhost:5433/metering_billing` (note: port **5433**, not the Postgres default 5432)

**3. Start Postgres, run migrations, seed data — one command**
```cmd
npm run setup
```
This runs `docker compose up -d --wait` (waits for the `pg_isready` healthcheck, avoiding a race against migrations), then `npm run migrate`, then `npm run seed` (creates the Free/Pro plans and two test tenants).

**4. (optional) Seed a tenant at 999/1000 quota**, for boundary testing
```cmd
npm run seed:near-quota
```

**5. Start the app**
```cmd
npm run dev
```

**6. (only if testing Stripe) Forward webhooks in a separate terminal**
```cmd
stripe listen --forward-to localhost:3000/webhooks/stripe
```
Confirm the printed `whsec_...` matches your `.env`'s `STRIPE_WEBHOOK_SECRET`; restart step 5 if you change it.

## Shutting Down

**1. Stop the app** — `Ctrl+C` in the `npm run dev` terminal.

**2. Stop the Stripe listener** (if running) — `Ctrl+C` in the `stripe listen` terminal.

**3. Stop Postgres, keep your data**
```cmd
docker compose down
```

**4. Full reset — wipe the database too** (only when you want a clean slate, e.g. after a schema change)
```cmd
docker compose down -v
```
Follow with `npm run setup` again to rebuild from scratch.

## Limitations

These are deliberate scope decisions, not oversights:

- **Authentication** — real signup/login is out of scope; see
  [Authentication](#authentication) above for the mock auth layer used
  instead.
- **`/generate` is simulated.** No real AI model is called — token counts
  are arbitrary numbers used to exercise the metering/quota/pricing
  pipeline. Nothing real is being "spent."
- **Stripe test mode only.** No real payments are ever processed; there is
  no path to live mode in this codebase.
- **One subscription row per tenant, not a history.** `subscriptions` is
  updated in place on each plan change rather than append-only. This
  mirrors Stripe's own Customer/Subscription split
- **No invoicing, proration, or overage billing.** A tenant is either
  within their plan's limits or blocked at the boundary (`429`/`402`);
  there's no partial-period billing or pay-per-overage.
- **Single-instance, local dev setup.** No load balancing, connection
  pooling tuning, rate limiting, or production deployment configuration;
  this is a correctness-focused capstone, not a hardened production
  service.
- **Webhook retry handling relies on Stripe's own retry logic.** There is
  no dead-letter queue or manual replay tooling beyond the Stripe CLI /
  dashboard's built-in event resend.

## Testing

```cmd
npm test
```

Runs the full suite. Every file mocks the query/service layer directly — no test touches a real Postgres database, so `npm test` runs without Docker.

| File | Covers |
|---|---|
| `tests/domain/domain.test.ts` | `calculateCost` (per-category pricing, independent rounding); `recordUsage` (new insert, duplicate lookup, 23505 race-recovery, non-unique errors rethrown); `checkQuota` (allowed, no-plan → 402, API-call and token limits → 429) |
| `tests/database/queries/usageEvents.test.ts` | `insertUsageEvent`/`findByIdempotencyKey` row-mapping and query shape, a mocked unique-violation error propagating correctly, `sumUsageForCurrentPeriod`/`sumUsageForPeriod` row-mapping and query bounds |
| `tests/routes/metering.test.ts` | `POST /generate` — auth, missing idempotency key, negative-amount validation, allowed usage, duplicate-before-quota-check, quota rejection; `GET /usage` — plan/usage/cost response shape, 402 with no subscription |
| `tests/routes/stripe.test.ts` | `POST /billing/checkout` — auth, session creation, 500 on missing checkout URL; public success/cancel pages; `POST /webhooks/stripe` — missing/invalid signature, verified processing, 500 on processing failure |

Run a single file:
```cmd
npx jest tests/routes/stripe.test.ts
```

Fully mocked throughout — safe to run repeatedly without Docker running or reseeding.

## Demo: Quota Boundary Test

Simulates a tenant sitting right at their plan's limit — the request at
the boundary is allowed, the next one is rejected. This is the scenario
the project's demo script rehearses (quota boundary → retry → upgrade).

**1. Start from a clean slate**
```cmd
docker compose down -v
```

**2. Start Postgres, run migrations, seed plans/tenants**
```cmd
npm run setup
```

**3. Seed a tenant at 999/1000 API calls**
```cmd
npm run seed:near-quota
```
This puts `test_free_key_123` one call away from the Free plan's limit.

**4. Start the app** (separate terminal)
```cmd
npm run dev
```

**5. Send the 1000th call — expect `201 Created`**
```cmd
curl -i -X POST http://localhost:3000/generate -H "Authorization: Bearer test_free_key_123" -H "Content-Type: application/json" -H "Idempotency-Key: boundary-1000" -d "{\"inputTokens\": 10, \"outputTokens\": 10}"
```

**6. Send the 1001st call — expect `429 Too Many Requests`**
```cmd
curl -i -X POST http://localhost:3000/generate -H "Authorization: Bearer test_free_key_123" -H "Content-Type: application/json" -H "Idempotency-Key: boundary-1001" -d "{\"inputTokens\": 10, \"outputTokens\": 10}"
```
Response body explains why: `"API call quota exceeded: 1001/1000 for the free plan this period."`

**7. Confirm via `/usage`**
```cmd
curl -i http://localhost:3000/usage -H "Authorization: Bearer test_free_key_123"
```
Shows `apiCalls: { used: 1000, limit: 1000 }` — the 1000th call counted, the 1001st did not.

**Reset when done** (so the next demo run starts clean, not still at the boundary):
```cmd
docker compose down -v
```