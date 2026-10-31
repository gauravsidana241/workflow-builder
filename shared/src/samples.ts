import type { FlowGraph } from "./dsl";

/**
 * Example workflows: used to seed the database and by the worker's sample
 * script. Positions are laid out top-to-bottom with loop bodies to the right.
 */

type Node = FlowGraph["nodes"][number];
type Edge = FlowGraph["edges"][number];

const n = (id: string, type: string, x: number, y: number, data: Record<string, unknown> = {}): Node => ({
  id,
  type,
  position: { x, y },
  data,
});
const e = (source: string, target: string, sourceHandle: string | null = null): Edge => ({
  id: `${source}-${sourceHandle ?? "out"}-${target}`,
  source,
  target,
  sourceHandle,
});

export interface SampleWorkflow {
  name: string;
  input: unknown;
  graph: FlowGraph;
}

export const SAMPLE_WORKFLOWS: SampleWorkflow[] = [
  {
    name: "Sum even numbers (loops, if, variables)",
    input: { numbers: [1, 2, 3, 4, 5, 6, 7, 8] },
    graph: {
      nodes: [
        n("trigger", "trigger", 0, 0, { sampleInput: '{ "numbers": [1, 2, 3, 4, 5, 6, 7, 8] }' }),
        n("init", "setVariable", 0, 130, { name: "total", value: "0" }),
        n("loop", "forEach", 0, 260, { items: "input.numbers", itemVar: "n" }),
        n("isEven", "if", 300, 390, { condition: "n % 2 == 0" }),
        n("add", "setVariable", 300, 520, { name: "total", value: "total + n" }),
        n("logIt", "log", 300, 650, { message: "added {{ n }}, total is now {{ total }}" }),
        n("done", "return", 0, 420, { value: "{ total, count: len(input.numbers) }" }),
      ],
      edges: [
        e("trigger", "init"),
        e("init", "loop"),
        e("loop", "isEven", "body"),
        e("isEven", "add", "true"),
        e("add", "logIt"),
        e("loop", "done", "done"),
      ],
    },
  },
  {
    name: "Fetch users from an API (HTTP, code, loop)",
    input: { minId: 3 },
    graph: {
      nodes: [
        n("trigger", "trigger", 0, 0, { sampleInput: '{ "minId": 3 }' }),
        n("fetch", "http", 0, 130, {
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/users",
          saveAs: "res",
        }),
        n("names", "setVariable", 0, 260, { name: "picked", value: "[]" }),
        n("loop", "forEach", 0, 390, { items: "res.body", itemVar: "user" }),
        n("check", "if", 300, 520, { condition: "user.id >= input.minId" }),
        n("pick", "setVariable", 300, 650, { name: "picked", value: "picked + [user.name]" }),
        n("stats", "code", 0, 520, {
          source: [
            "// Plain JavaScript: variables from the workflow are in scope.",
            "function initials(name) {",
            "  return name.split(' ').map((p) => p[0]).join('');",
            "}",
            "console.log('picked', picked.length, 'users');",
            "return { count: picked.length, initials: picked.map(initials) };",
          ].join("\n"),
          saveAs: "stats",
        }),
        n("post", "http", 0, 650, {
          method: "POST",
          url: "https://httpbin.org/post",
          body: "{{ { users: picked, stats } }}",
          saveAs: "echo",
          failOnError: false,
        }),
        n("done", "return", 0, 780, { value: "{ stats, echoStatus: echo.status }" }),
      ],
      edges: [
        e("trigger", "fetch"),
        e("fetch", "names"),
        e("names", "loop"),
        e("loop", "check", "body"),
        e("check", "pick", "true"),
        e("loop", "stats", "done"),
        e("stats", "post"),
        e("post", "done"),
      ],
    },
  },
  {
    name: "Durable delay (kill the worker mid-run)",
    input: { seconds: 20 },
    graph: {
      nodes: [
        n("trigger", "trigger", 0, 0, { sampleInput: "{}" }),
        n("before", "log", 0, 130, { message: "Starting. Stop the worker now, then start it again." }),
        n("wait", "delay", 0, 260, { duration: "20s" }),
        n("count", "repeat", 0, 390, { times: "3" }),
        n("tick", "log", 300, 520, { message: "tick {{ i + 1 }}" }),
        n("pause", "delay", 300, 650, { duration: "2s" }),
        n("done", "return", 0, 520, { value: "'survived the restart'" }),
      ],
      edges: [
        e("trigger", "before"),
        e("before", "wait"),
        e("wait", "count"),
        e("count", "tick", "body"),
        e("tick", "pause"),
        e("count", "done", "done"),
      ],
    },
  },
];
