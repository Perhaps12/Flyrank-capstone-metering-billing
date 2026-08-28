import { Router } from "express";
import { createCheckoutSession } from "../services/stripe";
import { getSubscriptionForTenant } from "../database/queries/subscriptions";

const router = Router();

// POST /billing/checkout — starts a Stripe test-mode Checkout session for
// the authenticated tenant to upgrade to Pro. Mounted AFTER mockAuth in
// app.ts (like metering.ts), so req.tenantId is already resolved here.
router.post("/checkout", async (req, res) => {
  const tenantId = req.tenantId;

  if (!tenantId) {
    // mockAuth should already guarantee this; this is a safety net, not
    // the primary auth check.
    return res.status(401).json({ error: "Unauthorized" });
  }

  const priceId = process.env.STRIPE_PRICE_ID_PRO;

  if (!priceId) {
    console.error("STRIPE_PRICE_ID_PRO is not set");
    return res.status(500).json({ error: "Billing is not configured" });
  }

  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  try {
    // Reuse the tenant's existing Stripe customer id if they have one
    // (e.g. re-subscribing after a cancellation) instead of letting
    // Stripe create a duplicate customer on every checkout attempt.
    const existingSubscription = await getSubscriptionForTenant(tenantId);

    const session = await createCheckoutSession({
      tenantId,
      priceId,
      customerId: existingSubscription?.stripeCustomerId ?? undefined,
      successUrl: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/billing/cancel`,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (error) {
    console.error("Failed to create Stripe checkout session:", error);
    return res.status(500).json({ error: "Could not start checkout" });
  }
});

export default router;