import { Request, Response, NextFunction } from "express";
import { findTenantByApiKey } from "../database/queries/tenants";

// Simulates authentication for this project's scope (real signup/sessions
// are an explicit non-goal — see DESIGN.md). Resolves the Authorization
// header into a tenant_id and attaches it to the request. Route handlers
// and domain functions should only ever read req.tenantId — never trust
// a tenant_id supplied directly in the request body.
export async function mockAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const apiKey = authHeader.slice("Bearer ".length).trim();

  const tenant = await findTenantByApiKey(apiKey);

  if (!tenant) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  req.tenantId = tenant.id;
  next();
}