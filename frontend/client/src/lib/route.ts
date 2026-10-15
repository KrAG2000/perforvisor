import { useEffect, useState } from "react";

export const routes = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "insights", label: "Insights" },
  { id: "trust", label: "Trust" },
  { id: "competitors", label: "Competitors" },
  { id: "ask", label: "Ask the advisor" },
] as const;

export type RouteId = (typeof routes)[number]["id"] | "connect";

const ids = new Set<string>([...routes.map((r) => r.id), "connect"]);

const parse = (hash: string): { id: RouteId; params: URLSearchParams } => {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  return { id: ids.has(path) ? (path as RouteId) : "overview", params: new URLSearchParams(query) };
};

/** Hash routing (#/trends, #/connect?role=competitor): bookmarkable, works with back/forward. */
export function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const href = (id: RouteId, params?: Record<string, string>) => `#/${id}${params ? `?${new URLSearchParams(params)}` : ""}`;
export const navigate = (id: RouteId, params?: Record<string, string>) => {
  window.location.hash = href(id, params);
};
