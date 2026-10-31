import "server-only";
import { desc, eq } from "drizzle-orm";
import { EMPTY_GRAPH, type FlowGraph } from "@app/shared";
import { db, schema } from "@/db";
import type { WorkflowDetail, WorkflowSummary } from "./types";

// Data access for workflows, used by both the API routes and server pages.

const toSummary = (row: { id: string; name: string; updatedAt: Date }): WorkflowSummary => ({
  id: row.id,
  name: row.name,
  updatedAt: row.updatedAt.toISOString(),
});

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const rows = await db
    .select({ id: schema.workflows.id, name: schema.workflows.name, updatedAt: schema.workflows.updatedAt })
    .from(schema.workflows)
    .orderBy(desc(schema.workflows.updatedAt));
  return rows.map(toSummary);
}

export async function getWorkflow(id: string): Promise<WorkflowDetail | null> {
  const row = await db.query.workflows.findFirst({ where: eq(schema.workflows.id, id) });
  return row ? { ...toSummary(row), graph: row.graph } : null;
}

export async function createWorkflow(name: string, graph: FlowGraph = EMPTY_GRAPH): Promise<WorkflowDetail> {
  const [row] = await db.insert(schema.workflows).values({ name, graph }).returning();
  return { ...toSummary(row), graph: row.graph };
}

export async function updateWorkflow(
  id: string,
  changes: { name?: string; graph?: FlowGraph },
): Promise<WorkflowDetail | null> {
  const [row] = await db
    .update(schema.workflows)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(schema.workflows.id, id))
    .returning();
  return row ? { ...toSummary(row), graph: row.graph } : null;
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const rows = await db.delete(schema.workflows).where(eq(schema.workflows.id, id)).returning({ id: schema.workflows.id });
  return rows.length > 0;
}
