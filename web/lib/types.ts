// Response shapes shared by the API routes and the browser code.
import type { FlowGraph, Issue, RunProgress } from "@app/shared";

export interface WorkflowSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface WorkflowDetail extends WorkflowSummary {
  graph: FlowGraph;
}

export interface SaveWorkflowResponse {
  workflow: WorkflowDetail;
  issues: Issue[];
}

/** Temporal's execution status, lower-cased. */
export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "terminated"
  | "timed_out"
  | "continued_as_new"
  | "unknown";

export interface RunSummary {
  id: string;
  workflowId: string;
  temporalWorkflowId: string;
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  status: RunStatus;
  input: unknown;
  progress: RunProgress | null;
  /** Why progress is null, e.g. the worker is not running. */
  progressError?: string;
  result?: unknown;
  error?: string;
  temporalUrl: string;
}

export interface StartRunResponse {
  run: RunSummary;
}

export interface ApiError {
  error: string;
  issues?: Issue[];
}
