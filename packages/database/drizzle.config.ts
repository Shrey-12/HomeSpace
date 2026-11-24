import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? "../../.env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://homespace:homespace@localhost:5432/homespace",
  },
});
