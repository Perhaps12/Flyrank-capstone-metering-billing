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