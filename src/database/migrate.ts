import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pool } from "./connection";

// Runs every .sql file in migrations/, in filename order, against the
// database. Filenames are numbered (001_, 002_, ...) specifically so
// this sort order matches the required execution order — later tables
// reference earlier ones via foreign keys.
async function runMigrations() {
  const migrationsDir = join(__dirname, "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    console.log(`Running migration: ${file}`);
    await pool.query(sql);
  }

  await pool.end();
  console.log("All migrations applied.");
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});