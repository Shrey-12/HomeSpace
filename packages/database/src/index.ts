import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export * from "./schema.js";

export type HomeSpaceDatabase = NodePgDatabase<typeof schema>;

export function connectDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
