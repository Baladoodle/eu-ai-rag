import path from "node:path";
import type { NextConfig } from "next";

/**
 * Next.js config.
 *
 * `serverExternalPackages` keeps the listed modules out of the webpack
 * bundle. Why: @mastra/*, voyageai, and the Anthropic SDK pull in native
 * dependencies (pg-native, undici) that fail to bundle. Keeping them as
 * external `require`s is the supported way to ship them in the serverless
 * runtime.
 *
 * `turbopack.root` pins the workspace root to this package. Why: when
 * the repo lives under a parent directory that also has a
 * package-lock.json (e.g. the hackathon workspace), Next.js picks the
 * wrong lockfile and prints a warning at build time. Pinning is the
 * supported way to silence it.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  serverExternalPackages: [
    "@mastra/rag",
    "@mastra/pg",
    "@mastra/core",
    "voyageai",
    "@anthropic-ai/sdk",
    "pino",
    "pino-pretty",
  ],
};

export default nextConfig;
