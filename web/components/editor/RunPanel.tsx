"use client";

import type { RunDetail, RunStatus, RunSummary } from "@/lib/types";

const STATUS_STYLE: Record<RunStatus, string> = {
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  terminated: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  timed_out: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  continued_as_new: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  unknown: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

const pre = "max-h-60 overflow-auto rounded bg-neutral-100 p-2 font-mono text-[11px] dark:bg-neutral-900";

interface Props {
  input: string;
  onInputChange: (value: string) => void;
  onResetInput: () => void;
  inputError: string | null;
  canRun: boolean;
  cannotRunReason: string | null;
  onRun: () => void;
  starting: boolean;
  error: string | null;
  runId: string | null;
  detail: RunDetail | null;
  runs: RunSummary[];
  onSelectRun: (id: string) => void;
  onFocusNode: (id: string) => void;
}

export function RunPanel(props: Props) {
  const { detail } = props;
  const progress = detail?.progress;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor="run-input" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Input (JSON)
          </label>
          <button type="button" onClick={props.onResetInput} className="text-[11px] text-neutral-500 hover:underline">
            Reset to sample
          </button>
        </div>
        <textarea
          id="run-input"
          rows={5}
          spellCheck={false}
          value={props.input}
          onChange={(e) => props.onInputChange(e.target.value)}
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        {props.inputError && <p className="text-[11px] text-red-600">{props.inputError}</p>}
        <button
          type="button"
          onClick={props.onRun}
          disabled={!props.canRun || props.starting}
          className="mt-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {props.starting ? "Starting..." : "▶ Run workflow"}
        </button>
        {props.cannotRunReason && <p className="text-[11px] text-neutral-500">{props.cannotRunReason}</p>}
        {props.error && <p className="text-xs text-red-600">{props.error}</p>}
      </div>

      {props.runId && (
        <section className="flex flex-col gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          {!detail ? (
            <p className="text-sm text-neutral-500">Loading run...</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[detail.status]}`}>
                  {detail.status.replace(/_/g, " ")}
                </span>
                <a
                  href={detail.temporalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Open in Temporal UI ↗
                </a>
              </div>
              <p className="font-mono text-[10px] text-neutral-400">{detail.temporalWorkflowId}</p>

              {detail.progressError && (
                <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {detail.progressError}. Is the worker running? (npm run dev:worker)
                </p>
              )}
              {detail.status === "running" && progress?.currentNodeId && (
                <p className="text-xs text-neutral-500">
                  Running{" "}
                  <button type="button" className="font-mono hover:underline" onClick={() => props.onFocusNode(progress.currentNodeId!)}>
                    {progress.currentNodeId}
                  </button>
                </p>
              )}
              {detail.error && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-red-600">Error</div>
                  <pre className={pre + " whitespace-pre-wrap text-red-700 dark:text-red-300"}>{detail.error}</pre>
                </div>
              )}
              {detail.status === "completed" && (
                <div>
                  <div className="mb-1 text-xs font-semibold">Result</div>
                  <pre className={pre}>{JSON.stringify(detail.result, null, 2)}</pre>
                </div>
              )}

              {progress && progress.logs.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold">Log</div>
                  <ul className="max-h-60 overflow-auto rounded bg-neutral-100 p-1 font-mono text-[11px] dark:bg-neutral-900">
                    {progress.logs.map((entry, i) => (
                      <li key={i} className={entry.level === "error" ? "text-red-600 dark:text-red-400" : ""}>
                        <button
                          type="button"
                          className="mr-1 text-neutral-400 hover:underline"
                          onClick={() => props.onFocusNode(entry.nodeId)}
                        >
                          [{entry.nodeId}]
                        </button>
                        {entry.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {progress && (
                <details>
                  <summary className="cursor-pointer text-xs font-semibold">Variables</summary>
                  <pre className={pre + " mt-1"}>{JSON.stringify(progress.vars, null, 2)}</pre>
                </details>
              )}
              <p className="text-[11px] text-neutral-500">Click a node to see its last output.</p>
            </>
          )}
        </section>
      )}

      {props.runs.length > 0 && (
        <section className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="mb-1 text-xs font-semibold">Recent runs</div>
          <ul className="flex flex-col">
            {props.runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => props.onSelectRun(run.id)}
                  className={
                    "w-full rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900 " +
                    (run.id === props.runId ? "bg-neutral-100 font-semibold dark:bg-neutral-900" : "")
                  }
                >
                  {new Date(run.createdAt).toLocaleString()}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
