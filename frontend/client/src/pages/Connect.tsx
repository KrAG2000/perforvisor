import { useEffect, useState, type FormEvent } from "react";
import type { Entity } from "@perforvisor/core";
import { Button, Card, Input, Select, Textarea } from "@perforvisor/ui";
import { api } from "../lib/api.ts";
import { parseReviews } from "../lib/parseReviews.ts";
import { navigate } from "../lib/route.ts";
import { useBusinesses } from "../state.tsx";

type Method = "google_maps" | "sample" | "paste";
type FoundEntity = Omit<Entity, "raw">;

export function Connect({ params }: { params: URLSearchParams }) {
  const { owned, select, refresh } = useBusinesses();
  const [method, setMethod] = useState<Method>("google_maps");
  const [role, setRole] = useState<"business" | "competitor">(
    params.get("role") === "competitor" && owned.length
      ? "competitor"
      : "business",
  );
  const [competitorOf, setCompetitorOf] = useState(
    params.get("of") ?? owned[0]?.key ?? "",
  );
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sources().then(
      (list) => {
        const available = list.map((s) => s.source);
        setSources(available);
        if (!available.includes("google_maps")) setMethod("sample");
      },
      () => setError("Couldn't reach Perforvisor. Is the backend running?"),
    );
  }, []);
  useEffect(() => {
    if (!competitorOf && owned[0]) setCompetitorOf(owned[0].key);
  }, [owned, competitorOf]);

  const tracking = role === "competitor" ? { role, competitorOf } : { role };

  const finish = async (key: string) => {
    await refresh();
    if (role === "business") {
      select(key);
      navigate("overview");
    } else {
      navigate("competitors");
    }
  };

  const track = async (entity: FoundEntity) => {
    setBusy(true);
    setError(null);
    try {
      const { business } = await api.track({ entity, ...tracking });
      await finish(business.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <Card>
        <div className="form">
          <div className="field">
            <span className="field-label">This is</span>
            <div className="segmented segmented--wide" role="radiogroup">
              <button
                type="button"
                role="radio"
                aria-checked={role === "business"}
                onClick={() => setRole("business")}
              >
                My business
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={role === "competitor"}
                disabled={!owned.length}
                onClick={() => setRole("competitor")}
              >
                A competitor
              </button>
            </div>
            {!owned.length && (
              <span className="field-hint">
                Connect your own business first; competitors are compared
                against it.
              </span>
            )}
          </div>
          {role === "competitor" && owned.length > 1 && (
            <label className="field">
              <span className="field-label">Competitor of</span>
              <Select
                value={competitorOf}
                onChange={(e) => setCompetitorOf(e.target.value)}
              >
                {owned.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <div className="field">
            <span className="field-label">Find it</span>
            <div className="segmented segmented--wide" role="tablist">
              {sources.includes("google_maps") && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === "google_maps"}
                  onClick={() => setMethod("google_maps")}
                >
                  Google Maps
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={method === "sample"}
                onClick={() => setMethod("sample")}
              >
                Sample data
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={method === "paste"}
                onClick={() => setMethod("paste")}
              >
                Paste reviews
              </button>
            </div>
          </div>
        </div>
      </Card>

      {error && <p className="ui-error">{error}</p>}
      {method === "google_maps" && (
        <GoogleMapsSearch onPick={track} busy={busy} />
      )}
      {method === "sample" && <SamplePicker onPick={track} busy={busy} />}
      {method === "paste" && (
        <PasteImport
          busy={busy}
          onImport={async (input) => {
            setBusy(true);
            setError(null);
            try {
              const { business } = await api.importReviews({
                ...input,
                ...tracking,
              });
              await finish(business.key);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Couldn't import those reviews.",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function GoogleMapsSearch({
  onPick,
  busy,
}: {
  onPick(entity: FoundEntity): void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundEntity[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; budget: number } | null>(
    null,
  );

  useEffect(() => {
    api.serpapiUsage().then(setUsage, () => {});
  }, []);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    setSearching(true);
    setError(null);
    try {
      setResults(await api.search("google_maps", query.trim()));
      setUsage(await api.serpapiUsage());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <Card>
      <form className="form" onSubmit={search}>
        <label className="field">
          <span className="field-label">Business name and area</span>
          <div className="input-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Paradise Biryani Secunderabad"
            />
            <Button
              variant="primary"
              type="submit"
              disabled={query.trim().length < 3 || searching}
            >
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
          <span className="field-hint">
            Each new search uses one SerpApi search
            {usage ? ` (${usage.used} of ${usage.budget} used this month)` : ""}
            . Syncing a new business uses about 3 more.
          </span>
        </label>
      </form>
      {error && <p className="ui-error">{error}</p>}
      {results && results.length === 0 && (
        <p className="muted">No places found. Try adding the area or city.</p>
      )}
      {results && results.length > 0 && (
        <ResultList results={results} onPick={onPick} busy={busy} />
      )}
    </Card>
  );
}

function SamplePicker({
  onPick,
  busy,
}: {
  onPick(entity: FoundEntity): void;
  busy: boolean;
}) {
  const [results, setResults] = useState<FoundEntity[] | null>(null);
  useEffect(() => {
    api.search("sample", "all").then(setResults, () => setResults([]));
  }, []);
  return (
    <Card>
      <p className="muted">
        Built-in demo businesses with a few months of reviews. Free, and a good
        way to see every page working.
      </p>
      {results && <ResultList results={results} onPick={onPick} busy={busy} />}
    </Card>
  );
}

function ResultList({
  results,
  onPick,
  busy,
}: {
  results: FoundEntity[];
  onPick(entity: FoundEntity): void;
  busy: boolean;
}) {
  return (
    <ul className="result-list">
      {results.map((r) => (
        <li key={`${r.ref.source}:${r.ref.externalId}`}>
          <div>
            <div className="result-name">{r.name}</div>
            <div className="muted small">
              {[
                r.category,
                r.address,
                r.rating !== undefined ? `${r.rating}★` : null,
                r.reviewCount !== undefined
                  ? `${r.reviewCount.toLocaleString()} reviews`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <Button size="sm" onClick={() => onPick(r)} disabled={busy}>
            Track
          </Button>
        </li>
      ))}
    </ul>
  );
}

function PasteImport({
  onImport,
  busy,
}: {
  onImport(input: {
    name: string;
    kind: "place" | "product";
    category?: string;
    reviews: ReturnType<typeof parseReviews>;
  }): void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"place" | "product">("place");
  const [text, setText] = useState("");
  const reviews = parseReviews(text);
  return (
    <Card>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onImport({ name: name.trim(), kind, reviews });
        }}
      >
        <p className="muted">
          For platforms without an API (Flipkart, Blinkit, Swiggy, Zomato
          exports, surveys). One review per line.
        </p>
        <div className="input-row">
          <label className="field grow">
            <span className="field-label">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Corner Bakery, Koramangala"
            />
          </label>
          <label className="field">
            <span className="field-label">Type</span>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as "place" | "product")}
            >
              <option value="place">Place</option>
              <option value="product">Product</option>
            </Select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">
            Reviews. Optional rating first: "4 | Great coffee, slow service"
          </span>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={
              "5 | Best croissants in town\n2 | Waited 30 minutes for a coffee"
            }
          />
          <span className="field-hint">{reviews.length} reviews</span>
        </label>
        <div className="form-actions">
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !name.trim() || reviews.length === 0}
          >
            Import and analyse
          </Button>
        </div>
      </form>
    </Card>
  );
}
