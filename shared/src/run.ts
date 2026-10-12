/**
 * Run-time contract between the interpreter workflow and the web app.
 *
 * Kept free of zod and other dependencies on purpose: the worker bundles this
 * into Temporal's workflow sandbox, which should only contain small,
 * deterministic code.
 */
import type { Dsl } from "./dsl";

export const INTERPRETER_WORKFLOW = "interpretWorkflow";
export const PROGRESS_QUERY = "getProgress";

export type NodeRunStatus = "running" | "done" | "failed";

export interface NodeRunState {
  status: NodeRunStatus;
  /** How many times this node ran (more than 1 inside loops). */
  runs: number;
  startedAt: number;
  finishedAt?: number;
  /** Output of the most recent run. */
  output?: unknown;
  error?: string;
}

export interface RunLogEntry {
  at: number;
  nodeId: string;
  level: "info" | "error";
  message: string;
}

export interface RunProgress {
  nodes: Record<string, NodeRunState>;
  logs: RunLogEntry[];
  vars: Record<string, unknown>;
  currentNodeId: string | null;
  finished: boolean;
  result?: unknown;
  error?: string;
}

export interface InterpretWorkflowArgs {
  dsl: Dsl;
  input: unknown;
}
