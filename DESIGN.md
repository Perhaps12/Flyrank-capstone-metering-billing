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