// Server entrypoint (also Vercel's: it detects src/index.ts for Fastify apps).
import { buildApp } from "./http.ts";
import { enqueueDueSyncs, getRuntime } from "./runtime.ts";

const runtime = await getRuntime();
const app = await buildApp(runtime);

// Locally there's no Vercel Cron: check for due re-syncs every hour in-process.
if (runtime.config.JOBS_DRIVER === "inline" && runtime.config.SYNC_INTERVAL_HOURS > 0) {
  setInterval(() => void enqueueDueSyncs(runtime).catch((err) => app.log.error({ err }, "scheduled re-sync failed")), 3_600_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await runtime.close();
    process.exit(0);
  });
}

await app.listen({ host: "0.0.0.0", port: runtime.config.API_PORT });

// Vercel's Fastify integration uses the exported instance.
export default app;
