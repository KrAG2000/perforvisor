import { z } from "zod";

const commaList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  CORS_ORIGINS: commaList,
  MONGO_URL: z.string().default("mongodb://localhost:27017/perforvisor"),
  // Database name; used even when the URI names none (the driver would fall back to "test").
  MONGO_DB: z.string().default("perforvisor"),
  DATABASE_URL: z
    .string()
    .default("postgres://perforvisor:perforvisor@localhost:5434/perforvisor"),
  // Postgres schema for Perforvisor's tables (identifier only); "perforvisor" when the
  // database is shared, e.g. a Tiger Cloud service used for other projects too.
  PG_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .default("public"),
  // Connections per process; keep low on Vercel, where many instances can run at once.
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Connector plugins to load; empty = every plugin whose settings are present.
  PLUGINS: commaList,
  // SerpApi guard: monthly search budget (free plan: 250) and response cache lifetime.
  SERPAPI_MONTHLY_BUDGET: z.coerce.number().int().nonnegative().default(200),
  SERPAPI_CACHE_HOURS: z.coerce.number().positive().default(24),
  // Review pages fetched on a business's first sync and on later re-syncs.
  SYNC_INITIAL_PAGES: z.coerce.number().int().min(1).max(10).default(3),
  SYNC_RESYNC_PAGES: z.coerce.number().int().min(1).max(10).default(1),
  // Automatic re-sync interval for tracked businesses; 0 disables it.
  SYNC_INTERVAL_HOURS: z.coerce.number().nonnegative().default(24),
  // How syncs run: "inline" in this process (local dev), or "vercel" through Vercel
  // Queues (consumed by the jobs service). Defaults to "vercel" on Vercel.
  JOBS_DRIVER: z
    .enum(["inline", "vercel"])
    .default(process.env.VERCEL ? "vercel" : "inline"),
  // Seconds one sync run may use before it hands off to a continuation (Vercel's
  // function limit is 300 s; leave headroom for the report and the hand-off).
  SYNC_RUN_SECONDS: z.coerce.number().int().positive().default(240),
  // Vercel sends it as a Bearer token on cron requests; required for /v1/cron/*.
  CRON_SECRET: z.string().optional(),

  // Model roles. Each is an OpenAI-compatible endpoint (a vLLM server).
  // vLLM accepts any key unless started with --api-key.
  MODEL_API_KEY: z.string().default("EMPTY"),
  CHAT_BASE_URL: z.url().default("http://localhost:8000/v1"),
  CHAT_MODEL: z.string().default("Qwen/Qwen3-4B-AWQ"),
  // Extraction defaults to the chat model.
  EXTRACT_BASE_URL: z.url().optional(),
  EXTRACT_MODEL: z.string().optional(),
  EMBED_BASE_URL: z.url().default("http://localhost:8001/v1"),
  EMBED_MODEL: z.string().default("google/embeddinggemma-2"),
  EMBED_DIMENSIONS: z.coerce.number().int().positive().default(768),
  LLM_CONCURRENCY: z.coerce.number().int().positive().default(4),
  // How many of the most similar reviews the answer step reads.
  ASK_TOP_K: z.coerce.number().int().min(1).max(30).default(8),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // MONGO_URI is accepted as an alias of MONGO_URL (Atlas's own name for it).
  if (!env.MONGO_URL && env.MONGO_URI) env = { ...env, MONGO_URL: env.MONGO_URI };
  // Treat `KEY=` lines in .env as unset so defaults apply.
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== ""),
  );
  const parsed = Env.safeParse(present);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export type ModelRole = "chat" | "extract";

export function chatEndpoint(config: Config, role: ModelRole) {
  return role === "extract"
    ? {
        baseUrl: config.EXTRACT_BASE_URL ?? config.CHAT_BASE_URL,
        model: config.EXTRACT_MODEL ?? config.CHAT_MODEL,
      }
    : { baseUrl: config.CHAT_BASE_URL, model: config.CHAT_MODEL };
}
