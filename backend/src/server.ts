import { app } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

const server = app.listen(env.PORT, () => {
  console.log(`wiseplan-backend listening on http://localhost:${env.PORT}`);
  console.log(`api base path: ${env.API_BASE_PATH}`);
  console.log(`auth mode: ${env.AUTH_MODE}`);
});

async function shutdown(signal: string) {
  console.log(`received ${signal}, shutting down...`);
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
