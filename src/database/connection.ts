import { Pool } from "pg";
import "dotenv/config";

// Single shared connection pool. Every query module imports this —
// no query function should create its own connection.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // Catches errors on idle clients in the pool (e.g. connection dropped).
  // Without this handler, such errors can crash the process unexpectedly.
  console.error("Unexpected error on idle Postgres client", err);
});