import { randomUUID } from "node:crypto";
import { Client, Connection } from "@temporalio/client";
import { config } from "../env";
import { example } from "../workflows";

async function run() {
  const connection = await Connection.connect({ address: config.temporalAddress });
  const client = new Client({ connection, namespace: config.namespace });

  const handle = await client.workflow.start(example, {
    taskQueue: config.taskQueue,
    args: ["Gaurav"],
    workflowId: "hello-" + randomUUID(),
  });

  console.log(await handle.result());
  await connection.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
