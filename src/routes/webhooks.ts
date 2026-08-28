import express, { Router } from "express";
import { verifyStripeSignature, type Stripe } from "../services/stripe";
import { handleWebhookEvent } from "../domain/billing";

const router = Router();

router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    if (typeof signature !== "string") {
      return res.status(400).json({
        error: "Missing Stripe-Signature header",
      });
    }

    let event: Stripe.Event;

    try {
      event = verifyStripeSignature(req.body, signature);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown verification error";

      console.error("Stripe webhook verification failed:", message);

      return res.status(400).json({
        error: "Invalid Stripe webhook signature",
      });
    }

    try {
      const result = await handleWebhookEvent(event);

      console.log("Stripe webhook processed:", {
        eventId: event.id,
        eventType: event.type,
        result,
      });

      return res.status(200).json({
        received: true,
        eventId: event.id,
        eventType: event.type,
        ...result,
      });
    } catch (error) {
      // Deliberately 500, not 200 — this tells Stripe to retry. See
      // domain/billing.ts: a failed plan update releases its claim so
      // the retry is actually reprocessed, not silently ignored.
      console.error("Stripe webhook processing failed:", error);

      return res.status(500).json({
        error: "Webhook processing failed",
      });
    }
  }
);

export default router;