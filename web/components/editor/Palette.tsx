"use client";

import { NODE_SPECS, NODE_TYPES, type NodeCategory, type NodeType } from "@app/shared";
import { CATEGORY_LABELS, NODE_UI } from "./nodeUi";

export const DRAG_MIME = "application/x-workflow-node";

const CATEGORIES: NodeCategory[] = ["start", "logic", "loops", "actions", "end"];

/**
 * Node palette. Drag an item onto the canvas (the canvas reads the type from
 * dataTransfer on drop), or click it to add it next to the selected node.
 */
export function Palette({ hasTrigger, onAdd }: { hasTrigger: boolean; onAdd: (type: NodeType) => void }) {
  return (
    <aside className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
      <p className="text-xs text-neutral-500">Drag onto the canvas, or click to add.</p>
      {CATEGORIES.map((category) => (
        <div key={category}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            {CATEGORY_LABELS[category]}
          </h3>
          <div className="flex flex-col gap-1.5">
            {NODE_TYPES.filter((t) => NODE_SPECS[t].category === category).map((type) => {
              const disabled = type === "trigger" && hasTrigger;
              return (
                <button
                  key={type}
                  type="button"
                  draggable={!disabled}
                  disabled={disabled}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, type);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onAdd(type)}
                  title={disabled ? "A workflow has exactly one Trigger" : NODE_SPECS[type].description}
                  className={[
                    "flex cursor-grab items-center gap-2 rounded border border-l-4 border-neutral-200 bg-white px-2 py-1.5 text-left text-sm active:cursor-grabbing dark:border-neutral-800 dark:bg-neutral-900",
                    NODE_UI[type].accent,
                    disabled ? "cursor-not-allowed opacity-40" : "hover:border-neutral-400 dark:hover:border-neutral-600",
                  ].join(" ")}
                >
                  <span aria-hidden className="w-4 text-center">
                    {NODE_UI[type].icon}
                  </span>
                  <span className="text-neutral-800 dark:text-neutral-200">{NODE_SPECS[type].label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
