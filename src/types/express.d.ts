// Extends Express's Request type so req.tenantId is recognized after
// mockAuth middleware runs. Route handlers can then read req.tenantId
// directly, type-checked, without casting.
import "express";

declare global {
  namespace Express {
    interface Request {
      tenantId?: number;
    }
  }
}