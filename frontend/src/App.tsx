import { useEffect, useState } from "react";
import { api } from "./api";
import AlertFeed from "./components/AlertFeed";
import Changelog from "./components/Changelog";
import DeprecationList from "./components/DeprecationList";
import SearchPanel from "./components/SearchPanel";
import JiraStatus from "./components/JiraStatus";
import { parseBackendTimestamp } from "./utils/datetime";
import { countSince, getLastSeen, markSeen, Section } from "./utils/notifications";

type Tab = "search" | "changelog" | "deprecated" | "alerts" | "jira";

const TABS: { id: Tab; label: string; section: Section | null }[] = [
  { id: "search", label: "Ask Pulse", section: null },
  { id: "changelog", label: "Changelog", section: "changelog" },
  { id: "deprecated", label: "Deprecated", section: "deprecated" },
  { id: "alerts", label: "Alerts", section: "alerts" },
  { id: "jira", label: "Jira & Agents", section: "jira" },
];

type Status = {
  anthropic_configured: boolean;
  local_embeddings_available: boolean;
  vector_store: string;
  jira_configured: boolean;
  jira_webhook_secured: boolean;
  model: string;
};

type NotificationState = {
  alerts: number;
  changelog: number;
  deprecated: number;
  jira: number;
};

const EMPTY_NOTIFS: NotificationState = {
  alerts: 0,
  changelog: 0,
  deprecated: 0,
  jira: 0,
};

export default function App() {
  const [tab, setTab] = useState<Tab>("search");
  const [status, setStatus] = useState<Status | null>(null);
  const [notifs, setNotifs] = useState<NotificationState>(EMPTY_NOTIFS);

  // ----- backend status -----
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/status");
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = await r.json();
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // ----- notification polling -----
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        // Fire all four in parallel — modest payloads, runs every 8s.
        const [alerts, changelog, deprecated, runs] = await Promise.all([
          api.alerts(),
          api.changelog(),
          api.features("deprecated"),
          api.agentRuns(50),
        ]);
        if (cancelled) return;

        const lsAlerts = getLastSeen("alerts");
        const lsChangelog = getLastSeen("changelog");
        const lsDeprecated = getLastSeen("deprecated");
        const lsJira = getLastSeen("jira");

        // Alerts: only unread items newer than lastSeen count.
        const newAlerts = alerts.filter(
          (a) =>
            !a.read_at &&
            parseBackendTimestamp(a.created_at).getTime() > lsAlerts.getTime(),
        );

        setNotifs({
          alerts: newAlerts.length,
          changelog: countSince(changelog, lsChangelog, (f) => f.updated_at),
          deprecated: countSince(deprecated, lsDeprecated, (f) => f.updated_at),
          jira: countSince(runs, lsJira, (r) => r.started_at),
        });
      } catch {
        // network blip — leave previous counts intact
      }
    }
    tick();
    const t = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  function selectTab(t: Tab, section: Section | null) {
    setTab(t);
    if (section) {
      markSeen(section);
      // Optimistically clear the badge for this section immediately so the
      // user doesn't see a stale count for ~8 seconds until the next poll.
      setNotifs((prev) => ({ ...prev, [section]: 0 }));
    }
  }

  function badgeFor(section: Section | null): { count: number } | null {
    if (!section) return null;
    const c = section === "alerts" ? notifs.alerts : notifs[section];
    return c > 0 ? { count: c } : null;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Pulse</h1>
        <div className="subtitle">Organizational memory</div>
        {TABS.map((t) => {
          const isActive = tab === t.id;
          const badge = !isActive ? badgeFor(t.section) : null;
          return (
            <div
              key={t.id}
              className={`nav-item ${isActive ? "active" : ""}`}
              onClick={() => selectTab(t.id, t.section)}
            >
              <span>{t.label}</span>
              {badge && (
                <span
                  className="nav-badge"
                  aria-label={`${badge.count} new in ${t.label}`}
                >
                  {badge.count > 99 ? "99+" : badge.count}
                </span>
              )}
            </div>
          );
        })}
        {status && (
          <div style={{ marginTop: 28, fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }}>
            <div>Model: {status.model}</div>
            <div>Claude API: {status.anthropic_configured ? "✓ live" : "✗ stub mode"}</div>
            <div>Embeddings: {status.local_embeddings_available ? "✓ local (MiniLM)" : "✗ hash fallback"}</div>
            <div>Vector store: {status.vector_store === "pinecone" ? "✓ Pinecone" : "in-memory"}</div>
            <div>Jira: {status.jira_configured ? "✓ live" : "✗ not configured"}</div>
            <div>Webhook secret: {status.jira_webhook_secured ? "✓ set" : "✗ unset"}</div>
          </div>
        )}
      </aside>
      <main className="main">
        {status !== null && status.anthropic_configured === false && (
          <div className="banner warn">
            <strong>Stub mode:</strong> no ANTHROPIC_API_KEY set. Agents will use a deterministic
            substitute — the pipeline runs end-to-end but reasoning quality is limited.
          </div>
        )}
        {status === null && (
          <div className="banner warn">
            <strong>Backend status unavailable.</strong> Pulse can't reach <code>localhost:8000</code>
            {" "}— make sure uvicorn is running and your Vite port is in <code>CORS_ORIGINS</code>.
          </div>
        )}
        {tab === "search" && <SearchPanel />}
        {tab === "changelog" && <Changelog />}
        {tab === "deprecated" && <DeprecationList />}
        {tab === "alerts" && <AlertFeed />}
        {tab === "jira" && <JiraStatus />}
      </main>
    </div>
  );
}
