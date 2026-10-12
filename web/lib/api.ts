import "server-only";
import { z } from "zod";
import type { ApiError } from "./types";

export function jsonError(status: number, error: string, extra: Omit<ApiError, "error"> = {}): Response {
  return Response.json({ error, ...extra } satisfies ApiError, { status });
}

/** Parse a JSON request body against a schema; returns the data or an error Response. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T> } | { response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: jsonError(400, "Request body must be JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return { response: jsonError(400, message) };
  }
  return { data: parsed.data };
}

export const uuidSchema = z.uuid();
