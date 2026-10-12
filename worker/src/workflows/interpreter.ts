import {
  ActivityFailure,
  ApplicationFailure,
  defineQuery,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
// Type-only imports are erased at compile time, so zod never enters the
// workflow bundle. Only the zod-free modules (expr, run) are imported as values.
import type { Dsl, DslNode } from "@app/shared/dsl";
import { evaluate, renderTemplate, resolveTemplate, type Scope } from "@app/shared/expr";
import { PROGRESS_QUERY, type InterpretWorkflowArgs, type RunProgress } from "@app/shared/run";
import type * as activities from "../activities";

/**
 * The interpreter: ONE workflow definition that can run ANY graph built in the
 * editor. The graph arrives as data (the DSL); this code walks it node by node.
 *
 * Determinism: this function is replayed from history after a worker restart,
 * so it must make the same decisions every time. Everything here is either
 * pure (expressions, templates) or goes through Temporal APIs that are recorded
 * in history (activities, sleep). User code and HTTP calls run as activities.
 */

export const progressQuery = defineQuery<RunProgress>(PROGRESS_QUERY);

/** Hard cap on node executions per run, to stay far from Temporal's history limits. */
const MAX_STEPS = 10_000;
const MAX_LOG_ENTRIES = 500;

/** Thrown by a Return node to unwind out of any nested loops. */
class ReturnSignal {
  constructor(public readonly value: unknown) {}
}

/** A node failed; carries the id of the node where it started. */
class NodeFailed extends Error {
  constructor(
    public readonly nodeId: string,
    message: string,
  ) {
    super(message);
  }
}

type StepResult = { output?: unknown; next?: string };

export async function interpretWorkflow({ dsl, input }: InterpretWorkflowArgs): Promise<unknown> {
  const vars: Scope = { input };
  const progress: RunProgress = { nodes: {}, logs: [], vars, currentNodeId: null, finished: false };
  let steps = 0;

  // Queries read state; they must not change it or call activities.
  setHandler(progressQuery, () => progress);

  const log = (nodeId: string, message: string, level: "info" | "error" = "info") => {
    progress.logs.push({ at: Date.now(), nodeId, level, message });
    if (progress.logs.length > MAX_LOG_ENTRIES) progress.logs.shift();
  };

  /** Run nodes one after another until a dead end (no next node). */
  async function runChain(startId: string | undefined): Promise<void> {
    let id = startId;
    while (id) {
      const node = dsl.nodes[id];
      if (!node) throw new NodeFailed(id, `Node "${id}" is missing from the workflow`);
      id = await runNode(node);
    }
  }

  async function runNode(node: DslNode): Promise<string | undefined> {
    if (++steps > MAX_STEPS) {
      throw new NodeFailed(node.id, `Stopped after ${MAX_STEPS} steps. Is a loop running away?`);
    }
    const state = progress.nodes[node.id] ?? { status: "running", runs: 0, startedAt: Date.now() };
    progress.nodes[node.id] = state;
    state.status = "running";
    state.runs += 1;
    state.startedAt = Date.now();
    state.error = undefined;
    progress.currentNodeId = node.id;

    try {
      const { output, next } = await execute(node);
      state.status = "done";
      state.output = output;
      state.finishedAt = Date.now();
      return next;
    } catch (err) {
      state.finishedAt = Date.now();
      if (err instanceof ReturnSignal) {
        state.status = "done";
        throw err;
      }
      state.status = "failed";
      if (err instanceof NodeFailed) {
        // Failure bubbled up from inside a loop body.
        state.error = `Stopped because node "${label(dsl, err.nodeId)}" failed`;
        throw err;
      }
      state.error = errorMessage(err);
      log(node.id, state.error, "error");
      throw new NodeFailed(node.id, state.error);
    }
  }

  async function execute(node: DslNode): Promise<StepResult> {
    switch (node.type) {
      case "trigger":
        return { output: input, next: node.next.out };

      case "setVariable": {
        const value = evaluate(node.data.value, vars);
        vars[node.data.name] = value;
        return { output: value, next: node.next.out };
      }

      case "if": {
        const result = Boolean(evaluate(node.data.condition, vars));
        return { output: result, next: result ? node.next.true : node.next.false };
      }

      case "forEach": {
        const items = evaluate(node.data.items, vars);
        if (!Array.isArray(items)) throw new Error(`"${node.data.items}" is not a list`);
        if (items.length > node.data.maxIterations) {
          throw new Error(`List has ${items.length} items, more than the max of ${node.data.maxIterations}`);
        }
        for (const [index, item] of items.entries()) {
          vars[node.data.itemVar] = item;
          vars[node.data.indexVar] = index;
          await runChain(node.next.body);
        }
        return { output: { iterations: items.length }, next: node.next.done };
      }

      case "repeat": {
        const times = Number(evaluate(node.data.times, vars));
        if (!Number.isInteger(times) || times < 0) throw new Error(`Times must be a whole number, got ${times}`);
        if (times > node.data.maxIterations) {
          throw new Error(`Asked to repeat ${times} times, more than the max of ${node.data.maxIterations}`);
        }
        for (let i = 0; i < times; i++) {
          vars[node.data.indexVar] = i;
          await runChain(node.next.body);
        }
        return { output: { iterations: times }, next: node.next.done };
      }

      case "while": {
        let iterations = 0;
        while (evaluate(node.data.condition, vars)) {
          if (iterations >= node.data.maxIterations) {
            throw new Error(`Condition still true after ${node.data.maxIterations} iterations (the max)`);
          }
          await runChain(node.next.body);
          iterations++;
        }
        return { output: { iterations }, next: node.next.done };
      }

      case "code": {
        const { runCode } = proxyActivities<typeof activities>({
          // The activity enforces the snippet timeout itself; this is a backstop.
          startToCloseTimeout: node.data.timeoutMs + 5_000,
          // A failing snippet is a bug in the snippet: don't retry it.
          retry: { maximumAttempts: 1 },
        });
        const { result, logs } = await runCode({ source: node.data.source, vars, timeoutMs: node.data.timeoutMs });
        for (const line of logs) log(node.id, line);
        if (node.data.saveAs) vars[node.data.saveAs] = result;
        return { output: result, next: node.next.out };
      }

      case "http": {
        const { httpRequest } = proxyActivities<typeof activities>({
          startToCloseTimeout: `${node.data.timeoutSeconds + 5}s`,
          retry: {
            maximumAttempts: node.data.maxAttempts,
            initialInterval: "1s",
            backoffCoefficient: 2,
            nonRetryableErrorTypes: ["HttpClientError"],
          },
        });
        // Templates are rendered here, in the workflow, so the activity gets
        // concrete values and the history shows exactly what was sent.
        const response = await httpRequest({
          method: node.data.method,
          url: renderTemplate(node.data.url, vars),
          headers: renderHeaders(node.data.headers, vars),
          body: node.data.body.trim() ? resolveTemplate(node.data.body, vars) : undefined,
          timeoutSeconds: node.data.timeoutSeconds,
          failOnError: node.data.failOnError,
        });
        if (node.data.saveAs) vars[node.data.saveAs] = response;
        return { output: response, next: node.next.out };
      }

      case "delay":
        // A durable timer: recorded in history, survives worker and server restarts.
        await sleep(node.data.duration as Parameters<typeof sleep>[0]);
        return { output: { waited: node.data.duration }, next: node.next.out };

      case "log": {
        const message = renderTemplate(node.data.message, vars);
        log(node.id, message);
        return { output: message, next: node.next.out };
      }

      case "return":
        throw new ReturnSignal(node.data.value.trim() ? evaluate(node.data.value, vars) : null);
    }
  }

  try {
    await runChain(dsl.startNodeId);
    progress.result = null;
  } catch (err) {
    if (err instanceof ReturnSignal) {
      progress.result = err.value;
    } else {
      progress.error = errorMessage(err);
      progress.finished = true;
      progress.currentNodeId = null;
      // A plain Error thrown from workflow code would only fail the workflow
      // *task* (Temporal retries it forever, assuming a bug in the code).
      // ApplicationFailure fails the workflow *execution*, which is what we want.
      throw ApplicationFailure.nonRetryable(progress.error, "NodeFailed", {
        nodeId: err instanceof NodeFailed ? err.nodeId : null,
      });
    }
  }
  progress.finished = true;
  progress.currentNodeId = null;
  return progress.result;
}

function renderHeaders(template: string, vars: Scope): Record<string, string> {
  if (!template.trim()) return {};
  let value = resolveTemplate(template, vars);
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('Headers must be a JSON object, e.g. { "Authorization": "Bearer {{ token }}" }');
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Headers must be a JSON object");
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
}

function errorMessage(err: unknown): string {
  // Activity errors arrive wrapped: ActivityFailure -> cause (ApplicationFailure, TimeoutFailure...)
  if (err instanceof ActivityFailure) return err.cause?.message ?? err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function label(dsl: Dsl, nodeId: string): string {
  const node = dsl.nodes[nodeId];
  return node?.data.label || node?.type || nodeId;
}
