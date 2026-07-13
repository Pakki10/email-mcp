import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["googleapis", "@anthropic-ai/sdk"],
};

export default nextConfig;
