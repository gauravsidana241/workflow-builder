import { ApplicationFailure } from "@temporalio/activity";

export interface HttpRequestInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Objects/arrays are sent as JSON; strings are sent as-is. */
  body?: unknown;
  timeoutSeconds: number;
  failOnError: boolean;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** Parsed JSON when the response is JSON, otherwise text. */
  body: unknown;
}

// Activity results are stored in the workflow's event history, which has a
// ~2 MB limit per payload. Keep responses well under it.
const MAX_BODY_CHARS = 256 * 1024;

/**
 * Activity: perform one HTTP request.
 *
 * Retries are configured by the workflow (per node) and handled by Temporal.
 * This function decides what is worth retrying:
 *   - network errors and timeouts  -> throw normally (retryable)
 *   - 5xx and 429                  -> retryable ApplicationFailure
 *   - other 4xx                    -> non-retryable: retrying won't fix a bad request
 */
export async function httpRequest(input: HttpRequestInput): Promise<HttpResponse> {
  const headers = new Headers(input.headers);
  let body: string | undefined;
  if (input.body !== undefined && input.body !== "" && input.method !== "GET") {
    if (typeof input.body === "string") {
      body = input.body;
    } else {
      body = JSON.stringify(input.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
  }

  const res = await fetch(input.url, {
    method: input.method,
    headers,
    body,
    signal: AbortSignal.timeout(input.timeoutSeconds * 1000),
  });

  let text = await res.text();
  if (text.length > MAX_BODY_CHARS) text = text.slice(0, MAX_BODY_CHARS);
  let parsed: unknown = text;
  if ((res.headers.get("content-type") ?? "").includes("json")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Truncated or invalid JSON: keep the text.
    }
  }

  const response: HttpResponse = {
    status: res.status,
    ok: res.ok,
    headers: Object.fromEntries(res.headers),
    body: parsed,
  };

  if (!res.ok && input.failOnError) {
    const message = `${input.method} ${input.url} returned ${res.status} ${res.statusText}`;
    if (res.status >= 500 || res.status === 429) {
      throw ApplicationFailure.retryable(message, "HttpServerError", response);
    }
    throw ApplicationFailure.nonRetryable(message, "HttpClientError", response);
  }
  return response;
}
