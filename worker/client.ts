import { Client, Connection } from "@temporalio/client";
import { nanoid } from "nanoid";
import { example } from "./workflows";

async function run() {
  const connection = await Connection.connect({ address: "localhost:7233" });

  const client = new Client({
    connection,
  });

  const handle = await client.workflow.start(example, {
    taskQueue: "hello-world",
    args: ["Gaurav"],
    workflowId: "workflow-" + nanoid(),
  });

  console.log(await handle.result());
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
