import "server-only";
import { Client, Connection } from "@temporalio/client";
import { env } from "./env";

export const temporalConfig = {
  address: env.temporalAddress,
  namespace: env.temporalNamespace,
  taskQueue: env.temporalTaskQueue,
  uiUrl: env.temporalUiUrl,
};

// One connection for the whole server process, kept across dev hot reloads.
const globalForTemporal = globalThis as unknown as { temporalClient?: Promise<Client> };

export function getTemporalClient(): Promise<Client> {
  globalForTemporal.temporalClient ??= Connection.connect({ address: temporalConfig.address })
    .then((connection) => new Client({ connection, namespace: temporalConfig.namespace }))
    .catch((err) => {
      // Don't cache a failed connection: let the next request retry.
      globalForTemporal.temporalClient = undefined;
      throw err;
    });
  return globalForTemporal.temporalClient;
}

export function temporalUiLink(workflowId: string, runId: string): string {
  const ns = encodeURIComponent(temporalConfig.namespace);
  return `${temporalConfig.uiUrl}/namespaces/${ns}/workflows/${encodeURIComponent(workflowId)}/${runId}/history`;
}
