import { z } from "zod";
import { flowGraphSchema } from "@app/shared";
import { parseBody } from "@/lib/api";
import { createWorkflow, listWorkflows } from "@/lib/workflows";

export async function GET() {
  return Response.json({ workflows: await listWorkflows() });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200).default("Untitled workflow"),
  graph: flowGraphSchema.optional(),
});

export async function POST(request: Request) {
  const body = await parseBody(request, createSchema);
  if ("response" in body) return body.response;
  const workflow = await createWorkflow(body.data.name, body.data.graph);
  return Response.json({ workflow }, { status: 201 });
}
