import fs from "node:fs";
import path from "node:path";

// One .env at the repo root is shared by the web app and the worker.
const envFile = path.resolve(__dirname, "../../.env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "workflow-builder",
};
