import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps a single .env at the repo root, shared with the worker.
// Next.js only reads .env files from web/, so load the root one explicitly.
loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {
  // The Temporal client uses gRPC native bindings; load it with Node's require
  // instead of bundling it into the server build.
  serverExternalPackages: ["@temporalio/client"],
};

export default nextConfig;
