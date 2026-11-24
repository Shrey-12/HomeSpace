import { connectDatabase } from "@homespace/database";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { createObjectStorage } from "./storage.js";

const { db, pool } = connectDatabase(config.databaseUrl);
const storage = createObjectStorage(config);
const app = createApp({ config, db, storage });

try {
  await storage.ensureBucket();
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  storage.close();
  await pool.end();
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    storage.close();
    await pool.end();
    process.exit(0);
  });
}
