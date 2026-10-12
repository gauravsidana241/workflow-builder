"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SAMPLE_WORKFLOWS } from "@app/shared/samples";
import type { WorkflowDetail, WorkflowSummary } from "@/lib/types";

const button =
  "rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900";

async function createWorkflow(body: object): Promise<WorkflowDetail> {
  const res = await fetch("/api/workflows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
  return ((await res.json()) as { workflow: WorkflowDetail }).workflow;
}

export function WorkflowList({ initial }: { initial: WorkflowSummary[] }) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCreate = () =>
    run(async () => {
      const workflow = await createWorkflow({ name: "Untitled workflow" });
      router.push(`/workflows/${workflow.id}`);
    });

  const onLoadExamples = () =>
    run(async () => {
      const created: WorkflowSummary[] = [];
      for (const sample of SAMPLE_WORKFLOWS) {
        created.push(await createWorkflow({ name: sample.name, graph: sample.graph }));
      }
      setWorkflows((list) => [...created.reverse(), ...list]);
    });

  const onDelete = (wf: WorkflowSummary) =>
    run(async () => {
      if (!confirm(`Delete "${wf.name}" and its run history?`)) return;
      const res = await fetch(`/api/workflows/${wf.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("Delete failed");
      setWorkflows((list) => list.filter((w) => w.id !== wf.id));
    });

  return (
    <div className="mt-6">
      <div className="flex gap-2">
        <button type="button" className={button + " bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"} onClick={onCreate} disabled={busy}>
          New workflow
        </button>
        <button type="button" className={button} onClick={onLoadExamples} disabled={busy}>
          Add example workflows
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {workflows.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">No workflows yet. Create one, or add the examples.</p>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-200 rounded border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {workflows.map((wf) => (
            <li key={wf.id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`/workflows/${wf.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium hover:underline">{wf.name}</div>
                <div className="text-xs text-neutral-500">Updated {new Date(wf.updatedAt).toLocaleString()}</div>
              </Link>
              <button type="button" onClick={() => onDelete(wf)} disabled={busy} className="text-xs text-neutral-500 hover:text-red-600">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
