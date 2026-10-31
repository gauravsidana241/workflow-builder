import { z } from "zod";
import { compileGraph } from "@app/shared";
import { jsonError, parseBody, uuidSchema } from "@/lib/api";
import { listRuns, startRun } from "@/lib/runs";
import { getWorkflow } from "@/lib/workflows";
import type { StartRunResponse } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]/runs">) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Workflow not found");
  return Response.json({ runs: await listRuns(id) });
}

const startSchema = z.object({ input: z.unknown().default({}) });

/** Compile the saved graph and start it in Temporal. */
export async function POST(request: Request, ctx: RouteContext<"/api/workflows/[id]/runs">) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Workflow not found");
  const body = await parseBody(request, startSchema);
  if ("response" in body) return body.response;

  const workflow = await getWorkflow(id);
  if (!workflow) return jsonError(404, "Workflow not found");

  const { dsl, issues } = compileGraph(workflow.graph);
  if (!dsl) return jsonError(422, "Fix the errors in the workflow before running it", { issues });

  try {
    const run = await startRun(id, dsl, body.data.input);
    return Response.json({ run } satisfies StartRunResponse, { status: 201 });
  } catch (err) {
    return jsonError(503, `Couldn't start the run in Temporal. Is the dev server running? (${(err as Error).message})`);
  }
}
