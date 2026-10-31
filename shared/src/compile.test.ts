import { describe, expect, it } from "vitest";
import { compileGraph } from "./compile";
import type { FlowGraph } from "./dsl";

const pos = { x: 0, y: 0 };
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: pos, data });
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${sourceHandle ?? "out"}-${target}`,
  source,
  target,
  sourceHandle,
});

describe("compileGraph", () => {
  it("compiles a loop with a branch", () => {
    const graph: FlowGraph = {
      nodes: [
        node("t", "trigger"),
        node("set", "setVariable", { name: "total", value: "0" }),
        node("loop", "forEach", { items: "input.items" }),
        node("if", "if", { condition: "item > 1" }),
        node("add", "setVariable", { name: "total", value: "total + item" }),
        node("ret", "return", { value: "total" }),
      ],
      edges: [
        edge("t", "set"),
        edge("set", "loop"),
        edge("loop", "if", "body"),
        edge("if", "add", "true"),
        edge("loop", "ret", "done"),
      ],
    };
    const { dsl, issues } = compileGraph(graph);
    expect(issues).toEqual([]);
    expect(dsl?.startNodeId).toBe("t");
    expect(dsl?.nodes.loop).toMatchObject({
      type: "forEach",
      data: { items: "input.items", itemVar: "item", indexVar: "index", maxIterations: 100 },
      next: { body: "if", done: "ret" },
    });
    expect(dsl?.nodes.if.next).toEqual({ true: "add" });
  });

  it("requires exactly one trigger", () => {
    expect(compileGraph({ nodes: [], edges: [] }).issues[0].message).toMatch(/Add a Trigger/);
    const two = compileGraph({ nodes: [node("a", "trigger"), node("b", "trigger")], edges: [edge("a", "b")] });
    expect(two.issues.some((i) => /Only one Trigger/.test(i.message))).toBe(true);
  });

  it("reports invalid settings and bad expressions per field", () => {
    const { dsl, issues } = compileGraph({
      nodes: [node("t", "trigger"), node("s", "setVariable", { name: "1bad", value: "1 +" })],
      edges: [edge("t", "s")],
    });
    expect(dsl).toBeNull();
    expect(issues).toContainEqual(expect.objectContaining({ nodeId: "s", field: "name" }));
    // Schema errors stop expression checks for that node, so fix the name first:
    const fixed = compileGraph({
      nodes: [node("t", "trigger"), node("s", "setVariable", { name: "ok", value: "1 +" })],
      edges: [edge("t", "s")],
    });
    expect(fixed.issues).toContainEqual(expect.objectContaining({ nodeId: "s", field: "value", severity: "error" }));
  });

  it("rejects two connections from one output", () => {
    const { issues } = compileGraph({
      nodes: [node("t", "trigger"), node("a", "log", { message: "a" }), node("b", "log", { message: "b" })],
      edges: [edge("t", "a"), edge("t", "b")],
    });
    expect(issues.some((i) => /Parallel branches/.test(i.message))).toBe(true);
  });

  it("rejects cycles", () => {
    const { issues } = compileGraph({
      nodes: [node("t", "trigger"), node("a", "log", { message: "a" }), node("b", "log", { message: "b" })],
      edges: [edge("t", "a"), edge("a", "b"), edge("b", "a")],
    });
    expect(issues.some((i) => /cycle/.test(i.message))).toBe(true);
  });

  it("requires loop bodies", () => {
    const { issues } = compileGraph({
      nodes: [node("t", "trigger"), node("r", "repeat", { times: "3" })],
      edges: [edge("t", "r")],
    });
    expect(issues).toContainEqual(expect.objectContaining({ nodeId: "r", message: "Connect the loop body to a node" }));
  });

  it("warns about unreachable nodes and leaves them out", () => {
    const { dsl, issues } = compileGraph({
      nodes: [node("t", "trigger"), node("a", "log", { message: "a" }), node("orphan", "log", { message: "x" })],
      edges: [edge("t", "a")],
    });
    expect(issues).toEqual([expect.objectContaining({ severity: "warning", nodeId: "orphan" })]);
    expect(Object.keys(dsl!.nodes).sort()).toEqual(["a", "t"]);
  });

  it("rejects edges into the trigger and from a return", () => {
    const { issues } = compileGraph({
      nodes: [node("t", "trigger"), node("r", "return")],
      edges: [edge("t", "r"), { id: "x", source: "r", target: "t", sourceHandle: null }],
    });
    expect(issues.some((i) => i.edgeId === "x")).toBe(true);
  });
});
