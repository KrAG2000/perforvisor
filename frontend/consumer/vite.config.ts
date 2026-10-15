import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin API calls in development; production routes /v1 through the ingress.
    proxy: { "/v1": "http://localhost:4000", "/health": "http://localhost:4000" },
  },
});
