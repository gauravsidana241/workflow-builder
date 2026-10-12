import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Temporal client uses gRPC native bindings; load it with Node's require
  // instead of bundling it into the server build.
  serverExternalPackages: ["@temporalio/client"],
};

export default nextConfig;
