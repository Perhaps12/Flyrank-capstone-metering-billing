CREATE TABLE processed_webhook_events (
  id SERIAL PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  processed_at TIMESTAMP DEFAULT now()
);