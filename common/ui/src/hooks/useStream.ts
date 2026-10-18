import { useCallback, useEffect, useRef, useState } from "react";
import { postSse } from "@perforvisor/core";
import type { z } from "zod";

export type StreamStatus = "idle" | "running" | "done" | "error";

export interface StreamState<T> {
  status: StreamStatus;
  message: string;
  percent: number;
  result: T | null;
  error: string | null;
}

const initial = {
  status: "idle",
  message: "",
  percent: 0,
  result: null,
  error: null,
} as const;

/** Runs a backend SSE flow (POST) and tracks its progress, result and errors. */
export function useStream<T>(schema: z.ZodType<T>) {
  const [state, setState] = useState<StreamState<T>>(initial);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (url: string, body: unknown) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setState({ ...initial, status: "running", message: "Starting…" });

      try {
        await postSse(
          url,
          body,
          (event) => {
            if (event.type === "progress") {
              setState((s) => ({
                ...s,
                message: event.message,
                percent: event.percent ?? s.percent,
              }));
            } else if (event.type === "result") {
              const parsed = schema.safeParse(event.data);
              setState((s) =>
                parsed.success
                  ? { ...s, status: "done", percent: 100, result: parsed.data }
                  : {
                      ...s,
                      status: "error",
                      error:
                        "The server sent a result in an unexpected format.",
                    },
              );
            } else if (event.type === "error") {
              setState((s) => ({
                ...s,
                status: "error",
                error: event.message,
              }));
            }
          },
          abort.signal,
        );
        // A stream that ends without a result or error was cut off.
        setState((s) =>
          s.status === "running"
            ? {
                ...s,
                status: "error",
                error: "The connection closed before the result arrived.",
              }
            : s,
        );
      } catch (error) {
        if (abort.signal.aborted) return;
        setState((s) => ({
          ...s,
          status: "error",
          error:
            error instanceof Error
              ? `Can't reach the server: ${error.message}`
              : "Can't reach the server.",
        }));
      }
    },
    [schema],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    setState(initial);
  }, []);

  return { ...state, run, reset };
}
