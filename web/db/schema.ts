import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { FlowGraph } from "@app/shared/dsl";

/** A workflow as the user built it: the raw React Flow graph. */
export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  graph: jsonb("graph").$type<FlowGraph>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One execution of a workflow. Temporal is the source of truth for run state;
 * this table records which Temporal execution belongs to which workflow, plus
 * the input and the exact DSL that was run (the graph may change afterwards).
 */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    temporalWorkflowId: text("temporal_workflow_id").notNull().unique(),
    temporalRunId: text("temporal_run_id").notNull(),
    input: jsonb("input").notNull(),
    dsl: jsonb("dsl").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_runs_workflow_id_idx").on(t.workflowId)],
);

export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
