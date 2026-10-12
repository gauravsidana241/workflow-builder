import { z } from "zod";
import { compileGraph, flowGraphSchema } from "@app/shared";
import { jsonError, parseBody, uuidSchema } from "@/lib/api";
import { deleteWorkflow, getWorkflow, updateWorkflow } from "@/lib/workflows";
import type { SaveWorkflowResponse } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Workflow not found");
  const workflow = await getWorkflow(id);
  if (!workflow) return jsonError(404, "Workflow not found");
  return Response.json({ workflow, issues: compileGraph(workflow.graph).issues } satisfies SaveWorkflowResponse);
}

const updateSchema = z
  .object({ name: z.string().trim().min(1).max(200).optional(), graph: flowGraphSchema.optional() })
  .refine((v) => v.name !== undefined || v.graph !== undefined, "Provide a name or a graph");

/**
 * Save. Invalid graphs are saved anyway (people save work in progress); the
 * response includes the validation issues so the editor can show them.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(404, "Workflow not found");
  const body = await parseBody(request, updateSchema);
  if ("response" in body) return body.response;
  const workflow = await updateWorkflow(id, body.data);
  if (!workflow) return jsonError(404, "Workflow not found");
  return Response.json({ workflow, issues: compileGraph(workflow.graph).issues } satisfies SaveWorkflowResponse);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success || !(await deleteWorkflow(id))) return jsonError(404, "Workflow not found");
  return new Response(null, { status: 204 });
}
