import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@perforvisor/backend", "@perforvisor/core", "@perforvisor/plugin-serpapi-google-maps"],
};

export default config;
