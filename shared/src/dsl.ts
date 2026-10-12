import { z } from "zod";

/**
 * The workflow DSL: the contract between the builder UI and the interpreter.
 *
 *   FlowGraph (what React Flow edits and Postgres stores)
 *        │  compileGraph()  (compile.ts)
 *        ▼
 *   Dsl       (what the Temporal interpreter workflow executes)
 *
 * Each node type is described once in NODE_SPECS: its settings schema, its
 * output handles, and which settings are expressions or {{templates}} so the
 * compiler can syntax-check them before a run ever starts.
 */

// ---------------------------------------------------------------------------
// Settings schemas for each node type
// ---------------------------------------------------------------------------

const identifier = z
  .string()
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, "Must be a valid variable name (letters, digits, _ and $; not starting with a digit)")
  .refine((name) => name !== "input", '"input" is reserved for the run input');

const optionalIdentifier = z.union([z.literal(""), identifier]).default("");

const maxIterations = z.coerce.number().int().min(1).max(1000).default(100);

/** "500ms", "5s", "2m", "1h", "1d" - the format Temporal's sleep() accepts. */
export const DURATION_RE = /^\d+(\.\d+)?\s*(ms|s|m|h|d)$/;

const base = { label: z.string().default("") };

export const nodeDataSchemas = {
  trigger: z.object({
    ...base,
    /** JSON shown pre-filled in the Run panel; becomes `input` in expressions. */
    sampleInput: z.string().default("{}"),
  }),
  setVariable: z.object({
    ...base,
    name: identifier,
    value: z.string().min(1, "Value expression is required"),
  }),
  if: z.object({
    ...base,
    condition: z.string().min(1, "Condition is required"),
  }),
  forEach: z.object({
    ...base,
    items: z.string().min(1, "Items expression is required"),
    itemVar: identifier.default("item"),
    indexVar: identifier.default("index"),
    maxIterations,
  }),
  repeat: z.object({
    ...base,
    times: z.string().min(1, "Times expression is required"),
    indexVar: identifier.default("i"),
    maxIterations,
  }),
  while: z.object({
    ...base,
    condition: z.string().min(1, "Condition is required"),
    maxIterations,
  }),
  code: z.object({
    ...base,
    source: z.string().min(1, "Code is required"),
    saveAs: optionalIdentifier,
    timeoutMs: z.coerce.number().int().min(10).max(60_000).default(2000),
  }),
  http: z.object({
    ...base,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().min(1, "URL is required"),
    /** JSON object template, e.g. { "Authorization": "Bearer {{ token }}" } */
    headers: z.string().default(""),
    /** Request body template. "{{ obj }}" alone sends obj as JSON. */
    body: z.string().default(""),
    saveAs: optionalIdentifier,
    timeoutSeconds: z.coerce.number().min(1).max(300).default(30),
    maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
    /** Fail the node on non-2xx responses (5xx/429 are retried, 4xx are not). */
    failOnError: z.boolean().default(true),
  }),
  delay: z.object({
    ...base,
    duration: z.string().trim().regex(DURATION_RE, 'Use a duration like "500ms", "5s", "2m" or "1h"'),
  }),
  log: z.object({
    ...base,
    message: z.string().min(1, "Message is required"),
  }),
  return: z.object({
    ...base,
    value: z.string().default(""),
  }),
} as const;

export type NodeType = keyof typeof nodeDataSchemas;
export type NodeData<T extends NodeType = NodeType> = z.output<(typeof nodeDataSchemas)[T]>;

// ---------------------------------------------------------------------------
// Node specs: handles and which fields hold expressions / templates
// ---------------------------------------------------------------------------

export type NodeCategory = "start" | "logic" | "loops" | "actions" | "end";

export interface NodeSpec {
  label: string;
  description: string;
  category: NodeCategory;
  /** Output handles. Loops use "body" (run per iteration) and "done". */
  outputs: readonly string[];
  /** Outputs that must be connected for the workflow to be valid. */
  requiredOutputs: readonly string[];
  /** Whether the node accepts incoming edges. */
  hasInput: boolean;
  /** Fields evaluated as expressions, e.g. `total + 1`. */
  expressionFields: readonly string[];
  /** Fields that may contain {{ expression }} blocks. */
  templateFields: readonly string[];
}

export const NODE_SPECS = {
  trigger: {
    label: "Trigger",
    description: "Where the workflow starts. The run input is available as `input`.",
    category: "start",
    outputs: ["out"],
    requiredOutputs: ["out"],
    hasInput: false,
    expressionFields: [],
    templateFields: [],
  },
  setVariable: {
    label: "Set Variable",
    description: "Evaluate an expression and store it in a variable.",
    category: "logic",
    outputs: ["out"],
    requiredOutputs: [],
    hasInput: true,
    expressionFields: ["value"],
    templateFields: [],
  },
  if: {
    label: "If",
    description: "Branch on a condition.",
    category: "logic",
    outputs: ["true", "false"],
    requiredOutputs: [],
    hasInput: true,
    expressionFields: ["condition"],
    templateFields: [],
  },
  forEach: {
    label: "For Each",
    description: "Run the body once per item in a list.",
    category: "loops",
    outputs: ["body", "done"],
    requiredOutputs: ["body"],
    hasInput: true,
    expressionFields: ["items"],
    templateFields: [],
  },
  repeat: {
    label: "Repeat",
    description: "Run the body a fixed number of times.",
    category: "loops",
    outputs: ["body", "done"],
    requiredOutputs: ["body"],
    hasInput: true,
    expressionFields: ["times"],
    templateFields: [],
  },
  while: {
    label: "While",
    description: "Run the body while a condition is true.",
    category: "loops",
    outputs: ["body", "done"],
    requiredOutputs: ["body"],
    hasInput: true,
    expressionFields: ["condition"],
    templateFields: [],
  },
  code: {
    label: "Code",
    description: "Run a JavaScript snippet. Variables are in scope; `return` a value to save it.",
    category: "actions",
    outputs: ["out"],
    requiredOutputs: [],
    hasInput: true,
    expressionFields: [],
    templateFields: [],
  },
  http: {
    label: "HTTP Request",
    description: "Call an API. Retries on network errors, 5xx and 429.",
    category: "actions",
    outputs: ["out"],
    requiredOutputs: [],
    hasInput: true,
    expressionFields: [],
    templateFields: ["url", "headers", "body"],
  },
  delay: {
    label: "Delay",
    description: "Wait durably. Survives worker and server restarts.",
    category: "actions",
    outputs: ["out"],
    requiredOutputs: [],
    hasInput: true,
    expressionFields: [],
    templateFields: [],
  },
  log: {
    label: "Log",
    description: "Write a message to the run log.",
    category: "actions",
    outputs: ["out"],
    requiredOutputs: [],
    hasInput: true,
    expressionFields: [],
    templateFields: ["message"],
  },
  return: {
    label: "Return",
    description: "End the workflow and return a value.",
    category: "end",
    outputs: [],
    requiredOutputs: [],
    hasInput: true,
    expressionFields: ["value"],
    templateFields: [],
  },
} as const satisfies Record<NodeType, NodeSpec>;

export const NODE_TYPES = Object.keys(NODE_SPECS) as NodeType[];

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === "string" && Object.hasOwn(NODE_SPECS, value);
}

export type OutputOf<T extends NodeType> = (typeof NODE_SPECS)[T]["outputs"][number];

/** Default settings for a freshly dropped node (fields with defaults filled in). */
export function defaultNodeData(type: NodeType): Record<string, unknown> {
  const starters: Partial<Record<NodeType, Record<string, unknown>>> = {
    setVariable: { name: "result", value: "0" },
    if: { condition: "true" },
    forEach: { items: "[1, 2, 3]" },
    repeat: { times: "3" },
    while: { condition: "false" },
    code: { source: "// Variables are in scope. Return a value to save it.\nreturn 1 + 1;" },
    http: { url: "https://httpbin.org/get" },
    delay: { duration: "5s" },
    log: { message: "Hello {{ input }}" },
  };
  const parsed = nodeDataSchemas[type].safeParse(starters[type] ?? {});
  return parsed.success ? (parsed.data as Record<string, unknown>) : { ...starters[type] };
}

// ---------------------------------------------------------------------------
// FlowGraph: what the editor saves (a subset of React Flow's nodes/edges)
// ---------------------------------------------------------------------------

export const flowGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      position: z.object({ x: z.number(), y: z.number() }),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string().nullish(),
    }),
  ),
});

export type FlowGraph = z.infer<typeof flowGraphSchema>;
export type FlowNode = FlowGraph["nodes"][number];
export type FlowEdge = FlowGraph["edges"][number];

export const EMPTY_GRAPH: FlowGraph = {
  nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: defaultNodeData("trigger") }],
  edges: [],
};

// ---------------------------------------------------------------------------
// Dsl: what the interpreter executes
// ---------------------------------------------------------------------------

export type DslNode = {
  [T in NodeType]: {
    id: string;
    type: T;
    data: NodeData<T>;
    /** Output handle -> next node id. Missing means "dead end". */
    next: Partial<Record<OutputOf<T>, string>>;
  };
}[NodeType];

export interface Dsl {
  version: 1;
  startNodeId: string;
  nodes: Record<string, DslNode>;
}

// ---------------------------------------------------------------------------
// Run progress: what the workflow exposes through its query
// ---------------------------------------------------------------------------

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
