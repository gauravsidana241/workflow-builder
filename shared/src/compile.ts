import {
  NODE_SPECS,
  isNodeType,
  nodeDataSchemas,
  type Dsl,
  type DslNode,
  type FlowGraph,
  type NodeType,
} from "./dsl";
import { checkExpression, checkTemplate } from "./expr";

export interface Issue {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}

export interface CompileResult {
  /** Null when there is at least one error. */
  dsl: Dsl | null;
  issues: Issue[];
}

/**
 * Validate a React Flow graph and turn it into the DSL the interpreter runs.
 *
 * Rules:
 *  - exactly one Trigger
 *  - node settings must match their schema; expressions and templates must parse
 *  - each output handle connects to at most one node (no parallel branches yet)
 *  - required outputs (Trigger "out", loop "body") must be connected
 *  - no cycles: repetition is expressed with loop nodes, not back-edges
 *  - nodes not reachable from the Trigger are reported and left out
 */
export function compileGraph(graph: FlowGraph): CompileResult {
  const issues: Issue[] = [];
  const error = (message: string, where: Omit<Issue, "severity" | "message"> = {}) =>
    issues.push({ severity: "error", message, ...where });
  const warn = (message: string, where: Omit<Issue, "severity" | "message"> = {}) =>
    issues.push({ severity: "warning", message, ...where });

  // 1. Node types and settings -------------------------------------------------
  const nodes = new Map<string, { type: NodeType; data: Record<string, unknown> }>();
  for (const node of graph.nodes) {
    if (!isNodeType(node.type)) {
      error(`Unknown node type "${node.type}"`, { nodeId: node.id });
      continue;
    }
    const spec = NODE_SPECS[node.type];
    const parsed = nodeDataSchemas[node.type].safeParse(node.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        error(issue.message, { nodeId: node.id, field: issue.path.join(".") || undefined });
      }
      // Keep the node so edge checks still run; it just won't compile.
      nodes.set(node.id, { type: node.type, data: node.data });
      continue;
    }
    const data = parsed.data as Record<string, unknown>;
    for (const field of spec.expressionFields) {
      const value = data[field];
      if (typeof value === "string" && value.trim() !== "") {
        const msg = checkExpression(value);
        if (msg) error(msg, { nodeId: node.id, field });
      }
    }
    for (const field of spec.templateFields) {
      const value = data[field];
      if (typeof value === "string") {
        const msg = checkTemplate(value);
        if (msg) error(msg, { nodeId: node.id, field });
      }
    }
    nodes.set(node.id, { type: node.type, data });
  }

  // 2. Exactly one trigger -----------------------------------------------------
  const triggers = [...nodes].filter(([, n]) => n.type === "trigger").map(([id]) => id);
  if (triggers.length === 0) error("Add a Trigger node: it's where the workflow starts");
  for (const id of triggers.slice(1)) error("Only one Trigger is allowed per workflow", { nodeId: id });

  // 3. Edges -------------------------------------------------------------------
  // next[nodeId][handle] = targetId
  const next = new Map<string, Record<string, string>>();
  for (const id of nodes.keys()) next.set(id, {});

  for (const edge of graph.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      error("Connection points to a node that doesn't exist", { edgeId: edge.id });
      continue;
    }
    const outputs: readonly string[] = NODE_SPECS[source.type].outputs;
    // React Flow leaves sourceHandle null when a node has a single, unnamed handle.
    const handle = edge.sourceHandle ?? (outputs.length === 1 ? outputs[0] : undefined);
    if (!handle || !outputs.includes(handle)) {
      error(`${NODE_SPECS[source.type].label} has no output "${edge.sourceHandle ?? ""}"`, {
        edgeId: edge.id,
        nodeId: edge.source,
      });
      continue;
    }
    if (!NODE_SPECS[target.type].hasInput) {
      error(`${NODE_SPECS[target.type].label} can't have incoming connections`, { edgeId: edge.id, nodeId: edge.target });
      continue;
    }
    const handles = next.get(edge.source)!;
    if (handles[handle]) {
      error(
        `Output "${handle}" is connected more than once. Parallel branches aren't supported yet: connect one node and chain the rest.`,
        { edgeId: edge.id, nodeId: edge.source },
      );
      continue;
    }
    handles[handle] = edge.target;
  }

  // 4. Required outputs --------------------------------------------------------
  for (const [id, node] of nodes) {
    for (const handle of NODE_SPECS[node.type].requiredOutputs) {
      if (!next.get(id)![handle]) {
        const what = handle === "body" ? "the loop body" : `output "${handle}"`;
        error(`Connect ${what} to a node`, { nodeId: id });
      }
    }
  }

  // 5. Cycles (DFS with white/grey/black colouring) ----------------------------
  const colour = new Map<string, "grey" | "black">();
  const visit = (id: string): void => {
    colour.set(id, "grey");
    for (const target of Object.values(next.get(id) ?? {})) {
      const c = colour.get(target);
      if (c === "grey") {
        error(
          "This connection creates a cycle. To repeat steps, use a For Each, Repeat or While node and its body output.",
          { nodeId: id, edgeId: graph.edges.find((e) => e.source === id && e.target === target)?.id },
        );
      } else if (c === undefined) {
        visit(target);
      }
    }
    colour.set(id, "black");
  };
  for (const id of nodes.keys()) if (!colour.has(id)) visit(id);

  // 6. Reachability from the trigger -------------------------------------------
  const start = triggers[0];
  const reachable = new Set<string>();
  if (start) {
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      stack.push(...Object.values(next.get(id) ?? {}));
    }
    for (const id of nodes.keys()) {
      if (!reachable.has(id)) warn("Not connected to the Trigger, so it will never run", { nodeId: id });
    }
  }

  // 7. Build the DSL -----------------------------------------------------------
  if (!start || issues.some((i) => i.severity === "error")) return { dsl: null, issues };

  const dslNodes: Record<string, DslNode> = {};
  for (const id of reachable) {
    const node = nodes.get(id)!;
    dslNodes[id] = { id, type: node.type, data: node.data, next: next.get(id)! } as DslNode;
  }
  return { dsl: { version: 1, startNodeId: start, nodes: dslNodes }, issues };
}
