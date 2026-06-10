import type { NextConfig } from "next";

/**
 * Next.js config.
 *
 * `serverExternalPackages` keeps the listed modules out of the webpack
 * bundle. Why: @mastra/*, voyageai, and the Anthropic SDK pull in native
 * dependencies (pg-native, undici) that fail to bundle. Keeping them as
 * external `require`s is the supported way to ship them in the serverless
 * runtime.
 */
const nextConfig: NextConfig = {
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
