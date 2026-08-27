import express from "express";
import metaRoutes from "./routes/meta";
import meteringRoutes from "./routes/metering";
import { mockAuth } from "./middleware/mockAuth";

const app = express();

// NOTE: express.json() parses every request body globally. This will
// break Stripe webhook signature verification, which needs the raw,
// unparsed body. When routes/webhooks.ts is added, its route needs to
// be registered BEFORE this line (or given its own raw-body parser),
// so JSON parsing never touches the webhook payload before signature
// verification runs.
app.use(express.json());

app.use("/", metaRoutes);

// mockAuth applies to everything below this line — every route past
// here requires a valid Authorization header, resolved to req.tenantId.
app.use(mockAuth);
app.use("/", meteringRoutes);

// Billing/webhook routes get registered here as they're built. Note:

export default app;