import type { NodeCategory, NodeType } from "@app/shared";

/**
 * Editor-only metadata for each node type: how it looks and which form fields
 * it has. The node's *behaviour* (schema, handles) lives in @app/shared.
 */

export type FieldKind = "text" | "expression" | "template" | "code" | "json" | "number" | "select" | "checkbox";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  help?: string;
  options?: readonly string[];
  rows?: number;
}

export interface NodeUi {
  icon: string;
  /** Tailwind classes for the accent colour. */
  accent: string;
  fields: FieldSpec[];
  summary: (data: Record<string, unknown>) => string;
}

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : String(v));

const labelField: FieldSpec = { key: "label", label: "Label", kind: "text", placeholder: "Optional name shown on the node" };

const loopLimit: FieldSpec = {
  key: "maxIterations",
  label: "Max iterations",
  kind: "number",
  help: "Safety limit (1 to 1000). The run fails if the loop would go past it.",
};

export const NODE_UI: Record<NodeType, NodeUi> = {
  trigger: {
    icon: "▶",
    accent: "border-l-emerald-500 text-emerald-600 dark:text-emerald-400",
    fields: [
      labelField,
      {
        key: "sampleInput",
        label: "Sample input (JSON)",
        kind: "json",
        rows: 6,
        help: "Pre-fills the Run panel. Available in expressions as `input`.",
      },
    ],
    summary: (d) => `input: ${str(d.sampleInput) || "{}"}`,
  },
  setVariable: {
    icon: "=",
    accent: "border-l-sky-500 text-sky-600 dark:text-sky-400",
    fields: [
      labelField,
      { key: "name", label: "Variable name", kind: "text", placeholder: "total" },
      { key: "value", label: "Value (expression)", kind: "expression", placeholder: "total + 1" },
    ],
    summary: (d) => `${str(d.name)} = ${str(d.value)}`,
  },
  if: {
    icon: "◇",
    accent: "border-l-amber-500 text-amber-600 dark:text-amber-400",
    fields: [labelField, { key: "condition", label: "Condition (expression)", kind: "expression", placeholder: "total > 10" }],
    summary: (d) => `if ${str(d.condition)}`,
  },
  forEach: {
    icon: "↻",
    accent: "border-l-violet-500 text-violet-600 dark:text-violet-400",
    fields: [
      labelField,
      { key: "items", label: "List (expression)", kind: "expression", placeholder: "input.users" },
      { key: "itemVar", label: "Item variable", kind: "text", placeholder: "item" },
      { key: "indexVar", label: "Index variable", kind: "text", placeholder: "index" },
      loopLimit,
    ],
    summary: (d) => `${str(d.itemVar) || "item"} in ${str(d.items)}`,
  },
  repeat: {
    icon: "↻",
    accent: "border-l-violet-500 text-violet-600 dark:text-violet-400",
    fields: [
      labelField,
      { key: "times", label: "Times (expression)", kind: "expression", placeholder: "3" },
      { key: "indexVar", label: "Counter variable", kind: "text", placeholder: "i", help: "0, 1, 2, ..." },
      loopLimit,
    ],
    summary: (d) => `${str(d.times)} times`,
  },
  while: {
    icon: "↻",
    accent: "border-l-violet-500 text-violet-600 dark:text-violet-400",
    fields: [
      labelField,
      { key: "condition", label: "Condition (expression)", kind: "expression", placeholder: "count < 5" },
      loopLimit,
    ],
    summary: (d) => `while ${str(d.condition)}`,
  },
  code: {
    icon: "{}",
    accent: "border-l-fuchsia-500 text-fuchsia-600 dark:text-fuchsia-400",
    fields: [
      labelField,
      {
        key: "source",
        label: "JavaScript",
        kind: "code",
        rows: 12,
        help: "Runs as an async function body. Workflow variables (and `vars`, `input`) are in scope; console.log goes to the run log; `return` a value.",
      },
      { key: "saveAs", label: "Save result as", kind: "text", placeholder: "result (optional)" },
      { key: "timeoutMs", label: "Timeout (ms)", kind: "number" },
    ],
    summary: (d) =>
      str(d.source)
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("//")) ?? "",
  },
  http: {
    icon: "⇄",
    accent: "border-l-blue-500 text-blue-600 dark:text-blue-400",
    fields: [
      labelField,
      { key: "method", label: "Method", kind: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      { key: "url", label: "URL", kind: "template", rows: 2, placeholder: "https://api.example.com/users/{{ id }}" },
      {
        key: "headers",
        label: "Headers (JSON)",
        kind: "template",
        rows: 3,
        placeholder: '{ "Authorization": "Bearer {{ token }}" }',
      },
      {
        key: "body",
        label: "Body",
        kind: "template",
        rows: 4,
        placeholder: "{{ { name: user.name } }}",
        help: "A single {{ expression }} is sent as JSON. Ignored for GET.",
      },
      {
        key: "saveAs",
        label: "Save response as",
        kind: "text",
        placeholder: "res (optional)",
        help: "Saved as { status, ok, headers, body }.",
      },
      { key: "timeoutSeconds", label: "Timeout (seconds)", kind: "number" },
      { key: "maxAttempts", label: "Max attempts", kind: "number", help: "Retries network errors, 5xx and 429 with backoff." },
      { key: "failOnError", label: "Fail on non-2xx response", kind: "checkbox" },
    ],
    summary: (d) => `${str(d.method) || "GET"} ${str(d.url)}`,
  },
  delay: {
    icon: "⏱",
    accent: "border-l-orange-500 text-orange-600 dark:text-orange-400",
    fields: [labelField, { key: "duration", label: "Duration", kind: "text", placeholder: "5s", help: 'e.g. "500ms", "10s", "2m", "1h"' }],
    summary: (d) => `wait ${str(d.duration)}`,
  },
  log: {
    icon: "✎",
    accent: "border-l-slate-500 text-slate-600 dark:text-slate-300",
    fields: [labelField, { key: "message", label: "Message", kind: "template", rows: 3, placeholder: "total is {{ total }}" }],
    summary: (d) => str(d.message),
  },
  return: {
    icon: "■",
    accent: "border-l-rose-500 text-rose-600 dark:text-rose-400",
    fields: [labelField, { key: "value", label: "Return value (expression)", kind: "expression", placeholder: "{ total }" }],
    summary: (d) => (str(d.value) ? `return ${str(d.value)}` : "end"),
  },
};

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  start: "Start",
  logic: "Logic",
  loops: "Loops",
  actions: "Actions",
  end: "End",
};

/** Labels drawn next to output handles; "out" is unlabeled. */
export const HANDLE_LABELS: Record<string, string> = {
  true: "true",
  false: "false",
  body: "body",
  done: "done",
};
