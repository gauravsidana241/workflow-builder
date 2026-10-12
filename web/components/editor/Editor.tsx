"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  NODE_TYPES,
  compileGraph,
  defaultNodeData,
  isNodeType,
  type FlowGraph,
  type Issue,
  type NodeType,
} from "@app/shared";
import type { SaveWorkflowResponse, WorkflowDetail } from "@/lib/types";
import { ConfigPanel, IssueNote } from "./ConfigPanel";
import { EditorContext, type EditorContextValue } from "./EditorContext";
import { DRAG_MIME, Palette } from "./Palette";
import { WorkflowNode, type EditorNode } from "./WorkflowNode";

// Defined once at module level: a new object every render would make React
// Flow re-mount every node.
const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, WorkflowNode])) satisfies NodeTypes;

type SaveState = "idle" | "saving" | "error";

// React Flow's colorMode={colorMode} reads the OS theme during render, which the
// server can't know, so the server HTML and the first client render disagree
// (a hydration mismatch). useSyncExternalStore renders "light" for hydration,
// then switches to the real value in the browser and follows OS changes.
const darkQuery = "(prefers-color-scheme: dark)";
function subscribeToColorScheme(onChange: () => void) {
  const mql = window.matchMedia(darkQuery);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
function useColorMode(): "light" | "dark" {
  return useSyncExternalStore(
    subscribeToColorScheme,
    () => (window.matchMedia(darkQuery).matches ? "dark" : "light"),
    () => "light",
  );
}

export function Editor({ workflow }: { workflow: WorkflowDetail }) {
  return (
    // useReactFlow() (for screen -> canvas coordinates) needs a provider above it.
    <ReactFlowProvider>
      <EditorInner workflow={workflow} />
    </ReactFlowProvider>
  );
}

function toFlowGraph(nodes: EditorNode[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
    edges: edges.map(({ id, source, target, sourceHandle }) => ({ id, source, target, sourceHandle })),
  };
}

function EditorInner({ workflow }: { workflow: WorkflowDetail }) {
  const { screenToFlowPosition, setCenter, getNode } = useReactFlow<EditorNode>();
  const colorMode = useColorMode();
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(
    workflow.graph.nodes.filter((n) => isNodeType(n.type)) as EditorNode[],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(workflow.graph.edges as Edge[]);
  const [name, setName] = useState(workflow.name);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // --- Live validation -----------------------------------------------------
  // The same compiler the server and worker use, run in the browser. Deferred
  // so dragging nodes stays smooth on big graphs.
  const graph = useMemo(() => toFlowGraph(nodes, edges), [nodes, edges]);
  const deferredGraph = useDeferredValue(graph);
  const { issues } = useMemo(() => compileGraph(deferredGraph), [deferredGraph]);
  const issuesByNode = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (!issue.nodeId) continue;
      map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue]);
    }
    return map;
  }, [issues]);
  const errorCount = issues.filter((i) => i.severity === "error").length;

  // --- Dirty tracking --------------------------------------------------------
  // Compare what would be saved with what was last saved (ignores selection etc.).
  const [lastSaved, setLastSaved] = useState(() =>
    JSON.stringify({ name: workflow.name, graph: toFlowGraph(nodes, edges) }),
  );
  const snapshot = JSON.stringify({ name, graph });
  const isDirty = snapshot !== lastSaved;

  const save = useCallback(async (): Promise<boolean> => {
    setSaveState("saving");
    setSaveError(null);
    const body = snapshot;
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      (await res.json()) as SaveWorkflowResponse;
      setLastSaved(body);
      setSaveState("idle");
      return true;
    } catch (err) {
      setSaveError((err as Error).message);
      setSaveState("error");
      return false;
    }
  }, [snapshot, workflow.id]);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // --- Graph editing ---------------------------------------------------------
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        // One edge per output handle: a new connection replaces the old one
        // (parallel branches aren't supported by the interpreter yet).
        addEdge(
          connection,
          eds.filter((e) => !(e.source === connection.source && (e.sourceHandle ?? null) === (connection.sourceHandle ?? null))),
        ),
      ),
    [setEdges],
  );

  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const id = `${type}_${crypto.randomUUID().slice(0, 6)}`;
      setNodes((nds) => [
        ...nds.map((n) => ({ ...n, selected: false })),
        { id, type, position, data: defaultNodeData(type), selected: true },
      ]);
    },
    [setNodes],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DRAG_MIME);
      if (!isNodeType(type)) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // Centre the node under the cursor (nodes are ~224px wide).
      addNode(type, { x: p.x - 112, y: p.y - 30 });
    },
    [addNode, screenToFlowPosition],
  );

  const selected = nodes.find((n) => n.selected);

  // Click-to-add: place below the selected node, or near the top of the graph.
  const onPaletteAdd = useCallback(
    (type: NodeType) => {
      const anchor = selected ?? nodes[nodes.length - 1];
      addNode(type, anchor ? { x: anchor.position.x, y: anchor.position.y + 130 } : { x: 0, y: 0 });
    },
    [addNode, nodes, selected],
  );

  const updateNodeData = useCallback(
    (id: string, key: string, value: unknown) =>
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, [key]: value } } : n))),
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    },
    [setEdges, setNodes],
  );

  const focusNode = useCallback(
    (id: string) => {
      const node = getNode(id);
      if (!node) return;
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      void setCenter(node.position.x + 112, node.position.y + 40, { zoom: 1.1, duration: 400 });
    },
    [getNode, setCenter, setNodes],
  );

  const context = useMemo<EditorContextValue>(
    () => ({ issuesByNode, runStateByNode: {}, currentNodeId: null }),
    [issuesByNode],
  );

  return (
    <EditorContext.Provider value={context}>
      <div className="flex h-dvh flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            ← Workflows
          </Link>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Workflow name"
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-base font-semibold hover:border-neutral-300 focus:border-blue-500 focus:outline-none dark:hover:border-neutral-700"
          />
          <span className="text-xs text-neutral-500" aria-live="polite">
            {saveState === "saving" && "Saving..."}
            {saveState === "idle" && (isDirty ? "Unsaved changes" : "All changes saved")}
            {saveState === "error" && <span className="text-red-600">Save failed: {saveError}</span>}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saveState === "saving" || !isDirty}
            className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Save
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <Palette hasTrigger={nodes.some((n) => n.type === "trigger")} onAdd={onPaletteAdd} />

          {/* Canvas */}
          <div className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={(c) => c.source !== c.target}
              deleteKeyCode={["Backspace", "Delete"]}
              colorMode={colorMode}
              fitView
              fitViewOptions={{ maxZoom: 1 }}
            >
              <Background />
              <MiniMap pannable zoomable />
              <Controls />
            </ReactFlow>

            {issues.length > 0 && (
              <div className="absolute bottom-3 left-14 z-10 max-h-40 w-96 overflow-y-auto rounded border border-neutral-200 bg-white/95 p-2 text-xs shadow dark:border-neutral-800 dark:bg-neutral-900/95">
                <div className="mb-1 font-semibold">
                  {errorCount > 0 ? `${errorCount} error${errorCount > 1 ? "s" : ""}` : "No errors"}
                  {issues.length - errorCount > 0 && `, ${issues.length - errorCount} warning(s)`}
                </div>
                <ul className="flex flex-col gap-1">
                  {issues.map((issue, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="w-full text-left disabled:cursor-default"
                        disabled={!issue.nodeId}
                        onClick={() => issue.nodeId && focusNode(issue.nodeId)}
                      >
                        <IssueNote issue={issue} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
            {selected ? (
              <ConfigPanel
                key={selected.id}
                node={selected}
                issues={issuesByNode.get(selected.id) ?? []}
                onChange={(key, value) => updateNodeData(selected.id, key, value)}
                onDelete={() => deleteNode(selected.id)}
              />
            ) : (
              <p className="text-sm text-neutral-500">Select a node to configure it.</p>
            )}
          </aside>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
