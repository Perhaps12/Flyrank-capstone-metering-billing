import { Router } from "express";

const router = Router();

// Simple health check — confirms the server is up and responding.
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;