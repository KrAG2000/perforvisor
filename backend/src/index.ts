// Server entrypoint, locally and on Vercel (which detects src/index.ts for Fastify apps).
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "./http.ts";
import { enqueueDueSyncs, getRuntime } from "./runtime.ts";

let appPromise: ReturnType<typeof startApp> | null = null;

async function startApp() {
  const runtime = await getRuntime();
  const app = await buildApp(runtime);
  await app.ready();
  return { runtime, app };
}

/** Builds the app once per instance; a failed start is retried on the next request. */
function getApp() {
  appPromise ??= startApp().catch((err: unknown) => {
    appPromise = null;
    throw err;
  });
  return appPromise;
}

/**
 * Vercel entry: hand each request to Fastify's server. Vercel's listen() integration
 * hung every request until the 60 s timeout, even for a minimal app; this form doesn't.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const { app } = await getApp();
    app.server.emit("request", req, res);
  } catch (err) {
    console.error("backend startup failed:", err);
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Backend is starting up or unavailable; try again shortly." }));
  }
}

if (!process.env.VERCEL) {
  const { runtime, app } = await getApp();

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
}
