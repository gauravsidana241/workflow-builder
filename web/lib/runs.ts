import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { WorkflowFailedError, type WorkflowExecutionStatusName } from "@temporalio/client";
import { INTERPRETER_WORKFLOW, PROGRESS_QUERY, type Dsl, type InterpretWorkflowArgs, type RunProgress } from "@app/shared";
import { db, schema } from "@/db";
import { getTemporalClient, temporalConfig, temporalUiLink } from "./temporal";
import type { RunDetail, RunStatus, RunSummary } from "./types";

type RunRow = typeof schema.workflowRuns.$inferSelect;

const toSummary = (row: RunRow): RunSummary => ({
  id: row.id,
  workflowId: row.workflowId,
  temporalWorkflowId: row.temporalWorkflowId,
  createdAt: row.createdAt.toISOString(),
});

/** Start the interpreter workflow in Temporal and record the run. */
export async function startRun(workflowId: string, dsl: Dsl, input: unknown): Promise<RunSummary> {
  const client = await getTemporalClient();
  // The workflow ID is ours to choose. Temporal guarantees only one open
  // execution per ID, which is what prevents accidental duplicate runs.
  const temporalWorkflowId = `wf-${workflowId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const args: InterpretWorkflowArgs = { dsl, input };
  // Started by name: the web app doesn't import worker code, only the contract.
  const handle = await client.workflow.start(INTERPRETER_WORKFLOW, {
    taskQueue: temporalConfig.taskQueue,
    workflowId: temporalWorkflowId,
    args: [args],
  });
  const [row] = await db
    .insert(schema.workflowRuns)
    .values({ workflowId, temporalWorkflowId, temporalRunId: handle.firstExecutionRunId, input: input ?? null, dsl })
    .returning();
  return toSummary(row);
}

export async function listRuns(workflowId: string, limit = 20): Promise<RunSummary[]> {
  const rows = await db
    .select()
    .from(schema.workflowRuns)
    .where(eq(schema.workflowRuns.workflowId, workflowId))
    .orderBy(desc(schema.workflowRuns.createdAt))
    .limit(limit);
  return rows.map(toSummary);
}

const STATUS: Record<WorkflowExecutionStatusName, RunStatus> = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  TERMINATED: "terminated",
  TIMED_OUT: "timed_out",
  CONTINUED_AS_NEW: "continued_as_new",
  UNKNOWN: "unknown",
  UNSPECIFIED: "unknown",
  PAUSED: "running",
};

/** Combine our run record with live state from Temporal. */
export async function getRun(runId: string): Promise<RunDetail | null> {
  const row = await db.query.workflowRuns.findFirst({ where: eq(schema.workflowRuns.id, runId) });
  if (!row) return null;

  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(row.temporalWorkflowId, row.temporalRunId);
  const description = await handle.describe();
  const status = STATUS[description.status.name] ?? "unknown";

  const detail: RunDetail = {
    ...toSummary(row),
    status,
    input: row.input,
    progress: null,
    temporalUrl: temporalUiLink(row.temporalWorkflowId, row.temporalRunId),
  };

  // Queries are answered by a worker (for closed workflows it replays the
  // history first), so this fails if no worker is running.
  try {
    detail.progress = await handle.query<RunProgress>(PROGRESS_QUERY);
  } catch (err) {
    detail.progressError = `Couldn't read progress from the worker: ${(err as Error).message}`;
  }

  if (status === "completed") {
    detail.result = await handle.result();
  } else if (status !== "running") {
    detail.error = await handle.result().then(
      () => undefined,
      (err: unknown) =>
        err instanceof WorkflowFailedError ? (err.cause?.message ?? err.message) : (err as Error).message,
    );
  }
  return detail;
}
