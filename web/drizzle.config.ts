import path from "node:path";
import { defineConfig } from "drizzle-kit";

process.loadEnvFile(path.resolve(__dirname, "../.env"));

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
