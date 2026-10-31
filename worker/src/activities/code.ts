import vm from "node:vm";
import { ApplicationFailure } from "@temporalio/activity";

export interface RunCodeInput {
  source: string;
  vars: Record<string, unknown>;
  timeoutMs: number;
}

export interface RunCodeOutput {
  result: unknown;
  logs: string[];
}

/**
 * Activity: run a user's JavaScript snippet.
 *
 * The snippet is the body of an async function: workflow variables are in
 * scope as globals (plus `vars` for all of them), `console.log` is captured,
 * and whatever it `return`s becomes the node's output.
 *
 * SECURITY: node:vm is NOT a security sandbox. Code can escape it and reach
 * the worker process. That's an accepted trade-off for a local demo; for
 * untrusted users, switch to a real isolate (isolated-vm, QuickJS/WASM, or a
 * separate container).
 *
 * Why an activity and not workflow code? User code might be slow, random or
 * time-dependent. Activities may be non-deterministic; workflows may not.
 */
export async function runCode(input: RunCodeInput): Promise<RunCodeOutput> {
  const logs: string[] = [];
  const format = (args: unknown[]) =>
    args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ");

  // Copy the variables so the snippet can't mutate workflow state by reference.
  const vars = structuredClone(input.vars);
  const context = vm.createContext({
    ...vars,
    vars,
    console: {
      log: (...args: unknown[]) => logs.push(format(args)),
      info: (...args: unknown[]) => logs.push(format(args)),
      warn: (...args: unknown[]) => logs.push("[warn] " + format(args)),
      error: (...args: unknown[]) => logs.push("[error] " + format(args)),
    },
  });

  let promise: Promise<unknown>;
  try {
    const script = new vm.Script(`(async () => {\n${input.source}\n})()`, { filename: "code-node.js" });
    // `timeout` only bounds the synchronous part (e.g. an infinite loop)...
    promise = script.runInContext(context, { timeout: input.timeoutMs }) as Promise<unknown>;
  } catch (err) {
    throw codeFailure(err, logs);
  }

  // ...so race the async part against a timer as well.
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Code timed out after ${input.timeoutMs}ms`)), input.timeoutMs);
      }),
    ]);
    // Results go into Temporal's history as JSON, so normalise them now
    // (drops functions/undefined, turns Dates into strings).
    return { result: result === undefined ? null : JSON.parse(safeJson(result)), logs };
  } catch (err) {
    throw codeFailure(err, logs);
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}

/** User code errors are bugs in the snippet: retrying won't help. */
function codeFailure(err: unknown, logs: string[]): ApplicationFailure {
  // Errors thrown inside the vm come from another realm, so `instanceof Error`
  // is false; read the fields directly.
  const e = err as { name?: string; message?: string };
  const message = e?.message ? `${e.name ?? "Error"}: ${e.message}` : String(err);
  return ApplicationFailure.nonRetryable(message, "CodeError", { logs });
}
