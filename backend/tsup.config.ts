import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  splitting: true,
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they are bundled in;
  // third-party dependencies stay external and are installed in the image.
  noExternal: [/^@perforvisor\//],
});
