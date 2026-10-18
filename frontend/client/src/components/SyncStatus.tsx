import { useEffect, useState } from "react";
import { StreamEvent, type BusinessSummary } from "@perforvisor/core";
import { Button, Progress } from "@perforvisor/ui";
import { api } from "../lib/api.ts";
import { useBusinesses } from "../state.tsx";

/** Live progress of a business's sync, streamed over SSE while it's queued or running. */
function useSyncProgress(business: BusinessSummary) {
  const { refresh } = useBusinesses();
  const active =
    business.sync.state === "queued" || business.sync.state === "running";
  const [live, setLive] = useState<{ message: string; percent: number } | null>(
    null,
  );

  useEffect(() => {
    if (!active) {
      setLive(null);
      return;
    }
    const source = new EventSource(api.syncEventsUrl(business.key));
    const handle = (raw: MessageEvent<string>) => {
      const event = StreamEvent.safeParse(JSON.parse(raw.data));
      if (!event.success) return;
      if (event.data.type === "progress")
        setLive({
          message: event.data.message,
          percent: event.data.percent ?? 0,
        });
      if (event.data.type === "done" || event.data.type === "error") {
        source.close();
        void refresh();
      }
    };
    for (const type of ["progress", "result", "done"])
      source.addEventListener(type, handle as EventListener);
    // The server's "error" events carry data; a bare "error" is a dropped connection, which EventSource retries.
    source.addEventListener("error", (e) => {
      if (e instanceof MessageEvent && e.data) handle(e);
    });
    return () => source.close();
  }, [active, business.key, refresh]);

  return { active, live };
}

export function SyncStatus({
  business,
  compact = false,
}: {
  business: BusinessSummary;
  compact?: boolean;
}) {
  const { refresh } = useBusinesses();
  const { active, live } = useSyncProgress(business);
  const [starting, setStarting] = useState(false);
  const { sync } = business;

  const syncNow = async () => {
    setStarting(true);
    try {
      await api.sync(business.key);
      await refresh();
    } finally {
      setStarting(false);
    }
  };

  if (active) {
    return (
      <Progress
        percent={live?.percent ?? sync.percent ?? 2}
        label={live?.message ?? sync.message ?? "Waiting to sync"}
      />
    );
  }
  if (compact) return null;

  const when = sync.finishedAt
    ? new Date(sync.finishedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  return (
    <div className="sync-line">
      {sync.state === "error" ? (
        <span className="ui-error">Last sync failed: {sync.error}</span>
      ) : (
        <span className="muted">
          {when ? `${sync.message ?? "Synced"} · ${when}` : "Not synced yet"}
        </span>
      )}
      {business.source !== "import" && (
        <Button size="sm" variant="ghost" onClick={syncNow} disabled={starting}>
          Sync now
        </Button>
      )}
    </div>
  );
}
