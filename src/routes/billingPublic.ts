import { Router } from "express";

const router = Router();

// Cosmetic browser redirect targets only — Stripe sends the customer's
// raw browser here after Checkout, which has no api_key to send, so
// these routes are deliberately public (mounted before mockAuth in
// app.ts). The real, trustworthy state change already happened via the
// webhook before the customer's browser ever lands here; nothing in
// these handlers should be treated as a source of truth.
router.get("/success", (req, res) => {
  const sessionId = req.query.session_id;

  res.status(200).send(
    `<h1>You're on Pro</h1><p>Checkout session: ${sessionId ?? "unknown"}</p><p>Check GET /usage to confirm your new limits.</p>`
  );
});

router.get("/cancel", (req, res) => {
  res
    .status(200)
    .send(`<h1>Checkout canceled</h1><p>No changes were made to your plan.</p>`);
});

export default router;