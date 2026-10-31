import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { config } from "./env";

async function run() {
  // Worker code uses `@temporalio/worker.NativeConnection`.
  // (Application code, like the Next.js API, uses `@temporalio/client.Connection`.)
  const connection = await NativeConnection.connect({ address: config.temporalAddress });
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.namespace,
      taskQueue: config.taskQueue,
      // Workflows are registered by path: they are bundled and run in a separate,
      // deterministic JS context.
      workflowsPath: require.resolve("./workflows"),
      activities,
    });

    // Runs until the process receives a shutdown signal (Ctrl+C) or hits a fatal error.
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
