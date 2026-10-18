import { pino, type LoggerOptions } from "pino";
import type { Config } from "../config.ts";

export function loggerOptions(config: Config): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    // pino-pretty runs in a worker thread that Vercel's bundle doesn't include.
    ...(config.NODE_ENV === "development" && !process.env.VERCEL && {
      transport: { target: "pino-pretty", options: { singleLine: true } },
    }),
  };
}

export const createLogger = (config: Config) => pino(loggerOptions(config));
