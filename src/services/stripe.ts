import Stripe from "stripe";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");

export const stripe = new Stripe(stripeSecretKey);

export function verifyStripeSignature(
  rawBody: Buffer,
  signatureHeader: string
): Stripe.Event {
  const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

  return stripe.webhooks.constructEvent(
    rawBody,
    signatureHeader,
    webhookSecret
  );
}

// Used by routes/billing.ts (POST /billing/checkout). client_reference_id
// is how the webhook handler later maps the completed session back to a
// tenant_id — it's set here at session-creation time, not guessed later.
export async function createCheckoutSession(params: {
  tenantId: number;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
}): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: params.priceId, quantity: 1 }],
    client_reference_id: String(params.tenantId),
    customer: params.customerId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}

export type { Stripe };