import express from "express";
import metaRoutes from "./routes/meta";
import meteringRoutes from "./routes/metering";
import { mockAuth } from "./middleware/mockAuth";
import webhooksRouter from "./routes/webhooks";
import billingRouter from "./routes/billing";
import billingPublicRouter from "./routes/billingPublic";

const app = express();

app.use("/webhooks", webhooksRouter);

app.use(express.json());

app.use("/", metaRoutes);

app.use("/billing", billingPublicRouter);   // public: GET /billing/success, /billing/cancel

// mockAuth applies to everything below this line — every route past
// here requires a valid Authorization header, resolved to req.tenantId.
app.use(mockAuth);
app.use("/", meteringRoutes);
app.use("/billing", billingRouter);

// Billing/webhook routes get registered here as they're built. Note:

export default app;