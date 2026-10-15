import { Select, ThemeToggle } from "@perforvisor/ui";
import { SyncStatus } from "./components/SyncStatus.tsx";
import { sourceLabel } from "./lib/format.ts";
import { href, navigate, routes, useRoute, type RouteId } from "./lib/route.ts";
import { BusinessesProvider, useBusinesses } from "./state.tsx";
import { Ask } from "./pages/Ask.tsx";
import { Competitors } from "./pages/Competitors.tsx";
import { Connect } from "./pages/Connect.tsx";
import { Insights } from "./pages/Insights.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Trends } from "./pages/Trends.tsx";
import { Trust } from "./pages/Trust.tsx";

const titles: Record<RouteId, string> = { ...Object.fromEntries(routes.map((r) => [r.id, r.label])), connect: "Connect a business" } as Record<RouteId, string>;

function Shell() {
  const route = useRoute();
  const { owned, selectedKey, select, detail } = useBusinesses();
  const business = detail?.business;

  const page = (() => {
    switch (route.id) {
      case "connect":
        return <Connect params={route.params} />;
      case "trends":
        return <Trends />;
      case "insights":
        return <Insights />;
      case "trust":
        return <Trust />;
      case "competitors":
        return <Competitors />;
      case "ask":
        return <Ask />;
      default:
        return <Overview />;
    }
  })();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Perforvisor</div>
        {owned.length > 0 && (
          <Select
            className="switcher"
            aria-label="Business"
            value={selectedKey ?? ""}
            onChange={(e) => {
              select(e.target.value);
              if (route.id === "connect") navigate("overview");
            }}
          >
            {owned.map((b) => (
              <option key={b.key} value={b.key}>{b.name}</option>
            ))}
          </Select>
        )}
        <nav className="nav">
          {routes.map((r) => (
            <a key={r.id} href={href(r.id)} className="nav-item" aria-current={r.id === route.id ? "page" : undefined}>
              {r.label}
            </a>
          ))}
          <a href={href("connect")} className="nav-item nav-item--add" aria-current={route.id === "connect" ? "page" : undefined}>
            + Connect a business
          </a>
        </nav>
        <div className="sidebar-footer">
          <ThemeToggle />
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <h1>{titles[route.id]}</h1>
          {business && route.id !== "connect" && (
            <span className="topbar-context">
              {business.name}
              <span className="muted small"> · {sourceLabel[business.source] ?? business.source}</span>
            </span>
          )}
        </header>
        <div className="content">
          {business && route.id !== "connect" && (
            <div className="sync-bar">
              <SyncStatus business={business} />
            </div>
          )}
          {page}
        </div>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BusinessesProvider>
      <Shell />
    </BusinessesProvider>
  );
}
