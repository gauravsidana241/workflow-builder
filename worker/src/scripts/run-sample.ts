import { randomUUID } from "node:crypto";
import { Client, Connection } from "@temporalio/client";
import { SAMPLE_WORKFLOWS, compileGraph } from "@app/shared";
import { config } from "../env";
import { interpretWorkflow, progressQuery } from "../workflows/interpreter";

// Usage: npm run sample -- [index]   (default 0)
// Runs one of the sample workflows against the dev server, so you can watch
// its event history in the Temporal UI.
async function main() {
  const index = Number(process.argv[2] ?? 0);
  const sample = SAMPLE_WORKFLOWS[index];
  if (!sample) throw new Error(`No sample ${index}. There are ${SAMPLE_WORKFLOWS.length}.`);

  const { dsl, issues } = compileGraph(sample.graph);
  if (!dsl) throw new Error("Sample does not compile: " + JSON.stringify(issues, null, 2));

  const connection = await Connection.connect({ address: config.temporalAddress });
  const client = new Client({ connection, namespace: config.namespace });
  const workflowId = `sample-${index}-${randomUUID().slice(0, 8)}`;
  const handle = await client.workflow.start(interpretWorkflow, {
    taskQueue: config.taskQueue,
    workflowId,
    args: [{ dsl, input: sample.input }],
  });
  console.log(`Started "${sample.name}"`);
  console.log(`  http://localhost:8233/namespaces/${config.namespace}/workflows/${workflowId}`);

  try {
    console.log("Result:", JSON.stringify(await handle.result(), null, 2));
  } finally {
    const progress = await handle.query(progressQuery);
    for (const entry of progress.logs) console.log(`  [${entry.nodeId}] ${entry.message}`);
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
