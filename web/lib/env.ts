import "server-only";
import fs from "node:fs";
import path from "node:path";

// The monorepo keeps one .env at the repo root, shared with the worker.
// Next.js only reads .env files from web/, so load the root one here.
// (Loading it from next.config.ts isn't enough: the config is evaluated in a
// different process from the one that runs route handlers.)
const rootEnv = path.resolve(process.cwd(), "..", ".env");
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://admin:password@localhost:5432/workflow_builder",
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "workflow-builder",
  temporalUiUrl: process.env.TEMPORAL_UI_URL ?? "http://localhost:8233",
};
