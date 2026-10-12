"use client";

import { NODE_SPECS, type Issue, type NodeRunState } from "@app/shared";
import { NODE_UI, type FieldSpec } from "./nodeUi";
import type { EditorNode } from "./WorkflowNode";

const inputClass =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

interface Props {
  node: EditorNode;
  issues: Issue[];
  runState?: NodeRunState;
  onChange: (key: string, value: unknown) => void;
  onDelete: () => void;
}

/** Settings form for the selected node, generated from its NODE_UI fields. */
export function ConfigPanel({ node, issues, runState, onChange, onDelete }: Props) {
  const spec = NODE_SPECS[node.type];
  const ui = NODE_UI[node.type];
  const nodeIssues = issues.filter((i) => !i.field);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className={`text-xs font-semibold uppercase tracking-wide ${ui.accent}`}>
          {ui.icon} {spec.label}
        </div>
        <p className="mt-1 text-xs text-neutral-500">{spec.description}</p>
        <p className="mt-1 font-mono text-[10px] text-neutral-400">id: {node.id}</p>
      </div>

      {nodeIssues.map((issue, i) => (
        <IssueNote key={i} issue={issue} />
      ))}

      {ui.fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={node.data[field.key]}
          issues={issues.filter((i) => i.field === field.key)}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}

      {runState && (
        <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="mb-1 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
            Last run: {runState.status}
            {runState.runs > 1 ? ` (ran ${runState.runs} times)` : ""}
          </div>
          {runState.error && <div className="mb-1 text-xs text-red-600">{runState.error}</div>}
          {runState.output !== undefined && (
            <pre className="max-h-48 overflow-auto rounded bg-neutral-100 p-2 text-[11px] dark:bg-neutral-900">
              {JSON.stringify(runState.output, null, 2)}
            </pre>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onDelete}
        className="self-start rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        Delete node
      </button>
    </div>
  );
}

function Field({
  field,
  value,
  issues,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  issues: Issue[];
  onChange: (value: unknown) => void;
}) {
  const id = `field-${field.key}`;
  const mono = ["expression", "template", "code", "json"].includes(field.kind) ? " font-mono" : "";
  const text = value === undefined || value === null ? "" : String(value);

  let control: React.ReactNode;
  switch (field.kind) {
    case "checkbox":
      control = (
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      );
      break;
    case "select":
      control = (
        <select id={id} className={inputClass} value={text} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
      break;
    case "number":
      control = (
        <input
          id={id}
          type="number"
          className={inputClass}
          value={text}
          // Keep the raw text while typing; the schema coerces it to a number.
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
      break;
    case "template":
    case "code":
    case "json":
      control = (
        <textarea
          id={id}
          rows={field.rows ?? 3}
          spellCheck={false}
          className={inputClass + mono + " text-xs"}
          placeholder={field.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          // Let Tab indent inside code instead of moving focus.
          onKeyDown={
            field.kind === "code"
              ? (e) => {
                  if (e.key !== "Tab") return;
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: s, selectionEnd: end } = el;
                  onChange(el.value.slice(0, s) + "  " + el.value.slice(end));
                  requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
                }
              : undefined
          }
        />
      );
      break;
    default:
      control = (
        <input
          id={id}
          className={inputClass + mono}
          placeholder={field.placeholder}
          value={text}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <div className={field.kind === "checkbox" ? "flex items-center gap-2" : "flex flex-col gap-1"}>
      {field.kind === "checkbox" && control}
      <label htmlFor={id} className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
        {field.label}
      </label>
      {field.kind !== "checkbox" && control}
      {field.help && <p className="text-[11px] text-neutral-500">{field.help}</p>}
      {issues.map((issue, i) => (
        <IssueNote key={i} issue={issue} />
      ))}
    </div>
  );
}

export function IssueNote({ issue }: { issue: Issue }) {
  const error = issue.severity === "error";
  return (
    <p
      className={
        "rounded px-2 py-1 text-[11px] " +
        (error
          ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
          : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300")
      }
    >
      {issue.message}
    </p>
  );
}
