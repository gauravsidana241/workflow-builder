"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { NODE_SPECS, type NodeType } from "@app/shared";
import { useEditorContext } from "./EditorContext";
import { HANDLE_LABELS, NODE_UI } from "./nodeUi";

export type EditorNode = Node<Record<string, unknown>, NodeType>;

const STATUS_RING = {
  running: "ring-2 ring-blue-500 animate-pulse",
  done: "ring-2 ring-emerald-500",
  failed: "ring-2 ring-red-500",
} as const;

/**
 * One component renders every node type. What differs per type (handles,
 * icon, colour, summary line) comes from NODE_SPECS and NODE_UI.
 */
function WorkflowNodeComponent({ id, type, data, selected }: NodeProps<EditorNode>) {
  const spec = NODE_SPECS[type];
  const ui = NODE_UI[type];
  const { issuesByNode, runStateByNode, currentNodeId } = useEditorContext();
  const issues = issuesByNode.get(id) ?? [];
  const hasError = issues.some((i) => i.severity === "error");
  const run = runStateByNode[id];
  const outputs: readonly string[] = spec.outputs;
  const title = (typeof data.label === "string" && data.label) || spec.label;
  const ring = run ? STATUS_RING[currentNodeId === id ? "running" : run.status] : "";

  return (
    <div
      className={[
        "relative w-56 rounded-md border border-l-4 bg-white text-left shadow-sm dark:bg-neutral-900",
        ui.accent,
        selected ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-300 dark:border-neutral-700",
        hasError ? "outline-2 outline-offset-2 outline-red-500 outline-dashed" : "",
        ring,
      ].join(" ")}
      title={issues.map((i) => i.message).join("\n") || undefined}
    >
      {spec.hasInput && <Handle type="target" position={Position.Top} className="h-2.5! w-2.5!" />}

      <div className="flex items-center gap-2 px-3 pt-2 text-xs font-semibold uppercase tracking-wide">
        <span aria-hidden>{ui.icon}</span>
        <span className="truncate">{spec.label}</span>
        {run && run.runs > 1 && (
          <span className="ml-auto rounded bg-neutral-100 px-1.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            ×{run.runs}
          </span>
        )}
      </div>
      <div className="px-3 pb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {title !== spec.label && <div className="truncate">{title}</div>}
        <div className="truncate font-mono text-xs font-normal text-neutral-500 dark:text-neutral-400">
          {ui.summary(data) || " "}
        </div>
      </div>
      {run?.status === "failed" && run.error && (
        <div className="mx-2 mb-1 truncate rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">
          {run.error}
        </div>
      )}

      {/* Room for handle labels */}
      {outputs.length > 1 ? <div className="h-4" /> : <div className="h-1" />}

      {outputs.map((handle, i) => {
        const left = `${((i + 1) / (outputs.length + 1)) * 100}%`;
        const label = HANDLE_LABELS[handle];
        return (
          <div key={handle}>
            <Handle id={handle} type="source" position={Position.Bottom} style={{ left }} className="h-2.5! w-2.5!" />
            {label && (
              <span
                className="pointer-events-none absolute bottom-1 -translate-x-1/2 text-[10px] text-neutral-500 dark:text-neutral-400"
                style={{ left }}
              >
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);
