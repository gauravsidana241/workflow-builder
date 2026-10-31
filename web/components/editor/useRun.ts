"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiError, RunDetail, RunSummary, StartRunResponse } from "@/lib/types";

const POLL_MS = 1000;

/**
 * Settled once Temporal reports the execution closed (completed, failed,
 * terminated...). The progress read in that same request is already final,
 * because a query on a closed workflow replays its full history.
 */
function isSettled(run: RunDetail): boolean {
  return run.status !== "running";
}

/**
 * Starts runs and polls the selected one. Polling (rather than websockets)
 * keeps this simple: the API reads Temporal's state on each request, so
 * Temporal stays the single source of truth.
 */
export function useRun(workflowId: string, initialRuns: RunSummary[]) {
  const [runs, setRuns] = useState(initialRuns);
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Poll the selected run until it settles.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        const body = (await res.json()) as { run: RunDetail } | ApiError;
        if (cancelled) return;
        if ("error" in body) {
          setError(body.error);
        } else {
          setError(null);
          setDetail(body.run);
          if (isSettled(body.run)) return;
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  const start = useCallback(
    async (input: unknown): Promise<boolean> => {
      setStarting(true);
      setError(null);
      try {
        const res = await fetch(`/api/workflows/${workflowId}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input }),
        });
        const body = (await res.json()) as StartRunResponse | ApiError;
        if ("error" in body) {
          setError(body.issues?.length ? `${body.error}: ${body.issues.map((i) => i.message).join("; ")}` : body.error);
          return false;
        }
        setDetail(null);
        setRunId(body.run.id);
        setRuns((list) => [body.run, ...list]);
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setStarting(false);
      }
    },
    [workflowId],
  );

  const select = useCallback((id: string | null) => {
    setDetail(null);
    setRunId(id);
  }, []);

  return { runs, runId, detail, error, starting, start, select };
}
