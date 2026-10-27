import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  async rewrites() {
    // Keep the /api prefix because Express mounts its routers under /api too.
    return [{ source: "/api/:path*", destination: "http://localhost:4000/api/:path*" }];
  }
};

export default nextConfig;
