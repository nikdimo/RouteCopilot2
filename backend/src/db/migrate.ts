import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(thisDir, "../../migrations");
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort();

    for (const fileName of files) {
      const exists = await client.query<{ version: string }>(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [fileName]
      );
      if (exists.rowCount && exists.rowCount > 0) {
        continue;
      }

      const fullPath = path.join(migrationsDir, fileName);
      const sql = await fs.readFile(fullPath, "utf8");

      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [fileName]);
      await client.query("COMMIT");
      console.log(`Applied migration: ${fileName}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
