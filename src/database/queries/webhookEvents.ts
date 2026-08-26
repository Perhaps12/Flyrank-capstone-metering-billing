import { pool } from "../connection";

// Checked after signature verification, before applying any change from
// a Stripe webhook — this is the dedup mechanism for Stripe's at-least-once
// event delivery (separate from /generate's idempotency-key mechanism).
export async function hasProcessedEvent(stripeEventId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM processed_webhook_events WHERE stripe_event_id = $1`,
    [stripeEventId]
  );
  return result.rows.length > 0;
}

// Recorded only after successfully applying the event's effect —
// relies on UNIQUE (stripe_event_id) as the backstop against concurrent
// duplicate deliveries.
export async function markEventProcessed(stripeEventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO processed_webhook_events (stripe_event_id)
     VALUES ($1)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [stripeEventId]
  );
}