import { pino, type LoggerOptions } from "pino";
import type { Config } from "../config.ts";

export function loggerOptions(config: Config): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === "development" && {
      transport: { target: "pino-pretty", options: { singleLine: true } },
    }),
  };
}

export const createLogger = (config: Config) => pino(loggerOptions(config));
