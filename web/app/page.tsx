import { connection } from "next/server";
import { WorkflowList } from "@/components/WorkflowList";
import { listWorkflows } from "@/lib/workflows";

export default async function Home() {
  // Render on every request: the list comes from Postgres, not from the build.
  await connection();
  const workflows = await listWorkflows();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Workflows</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Build workflows visually and run them on Temporal.
      </p>
      <WorkflowList initial={workflows} />
    </main>
  );
}
