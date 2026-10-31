import { jsonError, uuidSchema } from "@/lib/api";
import { getRun } from "@/lib/runs";

export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[runId]">) {
  const { runId } = await ctx.params;
  if (!uuidSchema.safeParse(runId).success) return jsonError(404, "Run not found");
  try {
    const run = await getRun(runId);
    if (!run) return jsonError(404, "Run not found");
    return Response.json({ run });
  } catch (err) {
    return jsonError(503, `Couldn't read the run from Temporal: ${(err as Error).message}`);
  }
}
