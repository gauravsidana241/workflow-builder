import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Editor } from "@/components/editor/Editor";
import { uuidSchema } from "@/lib/api";
import { getWorkflow } from "@/lib/workflows";

export default async function WorkflowPage(props: PageProps<"/workflows/[id]">) {
  await connection();
  const { id } = await props.params;
  if (!uuidSchema.safeParse(id).success) notFound();
  // Loaded on the server and passed down as a plain (serializable) prop.
  const workflow = await getWorkflow(id);
  if (!workflow) notFound();
  return <Editor workflow={workflow} />;
}
