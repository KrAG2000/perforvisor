import { StreamEvent } from "../schemas/stream.ts";

/**
 * POSTs JSON and reads the server-sent events in the response.
 * EventSource only supports GET, so this parses the stream with fetch.
 */
export async function postSse(url: string, body: unknown, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });

  // Validation errors come back as plain JSON before any stream starts.
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    const message = (detail as { message?: string } | null)?.message ?? `Request failed (${res.status})`;
    onEvent({ type: "error", message });
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue; // heartbeat comments
      const parsed = StreamEvent.safeParse(JSON.parse(data));
      if (parsed.success) onEvent(parsed.data);
    }
  }
}
