import express from "express";
import metaRoutes from "./routes/meta";
import { mockAuth } from "./middleware/mockAuth";


const app = express();

app.use(express.json());

app.use("/", metaRoutes);

// Additional routes (billing, webhooks, metering) get registered here
// as they're built.

export default app;