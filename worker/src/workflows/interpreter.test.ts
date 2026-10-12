import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkflowFailedError } from "@temporalio/client";
import { compileGraph, type FlowGraph, type RunProgress } from "@app/shared";
import * as activities from "../activities";
import { interpretWorkflow, progressQuery } from "./interpreter";

// ---------------------------------------------------------------------------
// Test setup: an in-memory Temporal server with time skipping, a worker, and a
// tiny local HTTP server for the HTTP node.
// ---------------------------------------------------------------------------

let env: TestWorkflowEnvironment;
let worker: Worker;
let workerRun: Promise<void>;
let server: http.Server;
let baseUrl: string;
const hits: Record<string, number> = {};
const taskQueue = "test-interpreter";

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.join(__dirname, "index.ts"),
    activities,
  });
  workerRun = worker.run();

  server = http.createServer((req, res) => {
    hits[req.url!] = (hits[req.url!] ?? 0) + 1;
    if (req.url === "/user/1") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 1, name: "Ada" }));
    } else if (req.url === "/echo") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization, body: JSON.parse(body) }));
      });
    } else if (req.url === "/flaky") {
      res.writeHead(500).end("boom");
    } else {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  worker?.shutdown();
  await workerRun;
  await env?.teardown();
  server?.close();
});

// ---------------------------------------------------------------------------
// Helpers: build a graph as a chain, compile it with the real compiler, run it.
// ---------------------------------------------------------------------------

type N = { id: string; type: string; data?: Record<string, unknown> };
type E = [source: string, target: string, handle?: string];

function graph(nodes: N[], edges: E[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: n.data ?? {} })),
    edges: edges.map(([source, target, sourceHandle], i) => ({ id: `e${i}`, source, target, sourceHandle })),
  };
}

async function run(g: FlowGraph, input: unknown = {}) {
  const { dsl, issues } = compileGraph(g);
  if (!dsl) throw new Error("Graph did not compile: " + JSON.stringify(issues));
  const handle = await env.client.workflow.start(interpretWorkflow, {
    taskQueue,
    workflowId: randomUUID(),
    args: [{ dsl, input }],
  });
  const result = await handle.result().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const progress: RunProgress = await handle.query(progressQuery);
  return { result, progress };
}

function failureMessage(error: unknown): string {
  expect(error).toBeInstanceOf(WorkflowFailedError);
  return (error as WorkflowFailedError).cause?.message ?? "";
}

// ---------------------------------------------------------------------------

describe("interpretWorkflow", () => {
  it("runs variables, a loop with a branch, and returns a value", async () => {
    const { result, progress } = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "sum", type: "setVariable", data: { name: "total", value: "0" } },
          { id: "loop", type: "forEach", data: { items: "input.numbers", itemVar: "n" } },
          { id: "even", type: "if", data: { condition: "n % 2 == 0" } },
          { id: "add", type: "setVariable", data: { name: "total", value: "total + n" } },
          { id: "ret", type: "return", data: { value: "{ total, count: len(input.numbers) }" } },
        ],
        [
          ["t", "sum"],
          ["sum", "loop"],
          ["loop", "even", "body"],
          ["even", "add", "true"],
          ["loop", "ret", "done"],
        ],
      ),
      { numbers: [1, 2, 3, 4, 5, 6] },
    );
    expect(result).toEqual({ ok: true, value: { total: 12, count: 6 } });
    expect(progress.finished).toBe(true);
    expect(progress.nodes.even).toMatchObject({ status: "done", runs: 6 });
    expect(progress.nodes.add).toMatchObject({ status: "done", runs: 3 });
  });

  it("supports repeat and while loops", async () => {
    const { result } = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "init", type: "setVariable", data: { name: "x", value: "1" } },
          { id: "rep", type: "repeat", data: { times: "3" } },
          { id: "double", type: "setVariable", data: { name: "x", value: "x * 2" } },
          { id: "wh", type: "while", data: { condition: "x < 100" } },
          { id: "plus", type: "setVariable", data: { name: "x", value: "x + 10" } },
          { id: "ret", type: "return", data: { value: "x" } },
        ],
        [
          ["t", "init"],
          ["init", "rep"],
          ["rep", "double", "body"],
          ["rep", "wh", "done"],
          ["wh", "plus", "body"],
          ["wh", "ret", "done"],
        ],
      ),
    );
    // 1 -> 8 after repeat; while adds 10 until >= 100 -> 108
    expect(result).toEqual({ ok: true, value: 108 });
  });

  it("runs code in an activity with variables in scope and captured logs", async () => {
    const { result, progress } = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "set", type: "setVariable", data: { name: "price", value: "20" } },
          {
            id: "code",
            type: "code",
            data: {
              source: "console.log('price is', price);\nfunction tax(p) { return p * 0.2 }\nreturn { total: price + tax(price), qty: input.qty };",
              saveAs: "order",
            },
          },
          { id: "ret", type: "return", data: { value: "order.total * order.qty" } },
        ],
        [
          ["t", "set"],
          ["set", "code"],
          ["code", "ret"],
        ],
      ),
      { qty: 2 },
    );
    expect(result).toEqual({ ok: true, value: 48 });
    expect(progress.logs.map((l) => l.message)).toContain("price is 20");
  });

  it("fails cleanly on a code error without retrying", async () => {
    const { result, progress } = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "code", type: "code", data: { source: "throw new Error('nope')" } },
        ],
        [["t", "code"]],
      ),
    );
    expect(result.ok).toBe(false);
    expect(failureMessage((result as { error: unknown }).error)).toMatch(/nope/);
    expect(progress.nodes.code).toMatchObject({ status: "failed", runs: 1 });
  });

  it("calls APIs with templated url, headers and JSON body", async () => {
    const { result } = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "get", type: "http", data: { url: `${baseUrl}/user/{{ input.id }}`, saveAs: "user" } },
          {
            id: "post",
            type: "http",
            data: {
              method: "POST",
              url: `${baseUrl}/echo`,
              headers: '{ "Authorization": "Bearer {{ input.token }}" }',
              body: "{{ { greeting: 'hi ' + user.body.name } }}",
              saveAs: "echo",
            },
          },
          { id: "ret", type: "return", data: { value: "echo.body" } },
        ],
        [
          ["t", "get"],
          ["get", "post"],
          ["post", "ret"],
        ],
      ),
      { id: 1, token: "secret" },
    );
    expect(result).toEqual({
      ok: true,
      value: { method: "POST", auth: "Bearer secret", body: { greeting: "hi Ada" } },
    });
  });

  it("does not retry 4xx responses", async () => {
    const { result } = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "get", type: "http", data: { url: `${baseUrl}/missing`, maxAttempts: 5 } },
        ],
        [["t", "get"]],
      ),
    );
    expect(failureMessage((result as { error: unknown }).error)).toMatch(/returned 404/);
    expect(hits["/missing"]).toBe(1);
  });

  it("retries 5xx responses up to maxAttempts", async () => {
    const { result } = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "get", type: "http", data: { url: `${baseUrl}/flaky`, maxAttempts: 3 } },
        ],
        [["t", "get"]],
      ),
    );
    expect(failureMessage((result as { error: unknown }).error)).toMatch(/returned 500/);
    expect(hits["/flaky"]).toBe(3);
  });

  it("sleeps durably (time-skipped in tests)", async () => {
    const started = Date.now();
    const { result } = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "wait", type: "delay", data: { duration: "2h" } },
          { id: "ret", type: "return", data: { value: "'woke up'" } },
        ],
        [
          ["t", "wait"],
          ["wait", "ret"],
        ],
      ),
    );
    expect(result).toEqual({ ok: true, value: "woke up" });
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("fails the run (not just the task) on expression errors and caps runaway loops", async () => {
    const bad = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "set", type: "setVariable", data: { name: "x", value: "input.a.b" } },
        ],
        [["t", "set"]],
      ),
    );
    expect(failureMessage((bad.result as { error: unknown }).error)).toMatch(/Cannot read property "b"/);

    const runaway = await run(
      graph(
        [
          { id: "t", type: "trigger" },
          { id: "wh", type: "while", data: { condition: "true", maxIterations: 5 } },
          { id: "log", type: "log", data: { message: "tick" } },
        ],
        [
          ["t", "wh"],
          ["wh", "log", "body"],
        ],
      ),
    );
    expect(failureMessage((runaway.result as { error: unknown }).error)).toMatch(/after 5 iterations/);
    expect(runaway.progress.nodes.log.runs).toBe(5);
  });
});
