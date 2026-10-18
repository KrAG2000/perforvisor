import type { FastifyReply, FastifyRequest } from "fastify";
import type { StreamEvent } from "@perforvisor/core";

export interface SseStream {
  send(event: StreamEvent): void;
  /** True once the client has disconnected; long-running work should stop. */
  readonly closed: boolean;
  /** Aborts when the client disconnects; pass it to model calls and graph runs. */
  readonly signal: AbortSignal;
  end(): void;
}

/** Takes over the response and streams StreamEvents as server-sent events. */
export function openSse(
  request: FastifyRequest,
  reply: FastifyReply,
): SseStream {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Stops proxies such as nginx ingress from buffering the stream.
    "X-Accel-Buffering": "no",
    ...corsHeaders(request),
  });

  let closed = false;
  const abort = new AbortController();
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
  // Listen on the response, not the request: a request emits "close" as soon as
  // its body has been read, which would end every POST stream immediately.
  res.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    abort.abort();
  });

  return {
    send(event) {
      if (!closed)
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    get closed() {
      return closed;
    },
    signal: abort.signal,
    end() {
      if (!closed) res.end();
    },
  };
}

// hijack() skips Fastify's onSend hooks, so @fastify/cors headers must be copied over.
function corsHeaders(request: FastifyRequest): Record<string, string> {
  const origin = request.headers.origin;
  return origin
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : {};
}
