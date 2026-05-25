import { useEffect, useState } from "react";
import { api, auth, AuthUser, clearToken, getToken, API_BASE } from "./api";
import AlertFeed from "./components/AlertFeed";
import Changelog from "./components/Changelog";
import DeprecationList from "./components/DeprecationList";
import JiraAccounts from "./components/JiraAccounts";
import Login from "./components/Login";
import SearchPanel from "./components/SearchPanel";
import JiraStatus from "./components/JiraStatus";
import { parseBackendTimestamp } from "./utils/datetime";
import { countSince, getLastSeen, markSeen, Section } from "./utils/notifications";

type Tab = "search" | "changelog" | "deprecated" | "alerts" | "jira" | "accounts";

type TabDef = {
  id: Tab;
  label: string;
  section: Section | null;
  adminOnly?: boolean;
};

const TABS: TabDef[] = [
  { id: "search", label: "Ask Pulse", section: null },
  { id: "changelog", label: "Changelog", section: "changelog" },
  { id: "deprecated", label: "Deprecated", section: "deprecated" },
  { id: "alerts", label: "Alerts", section: "alerts" },
  { id: "jira", label: "Jira & Agents", section: "jira" },
  { id: "accounts", label: "Jira Accounts", section: null, adminOnly: true },
];

type Status = {
  anthropic_configured: boolean;
  local_embeddings_available: boolean;
  vector_store: string;
  jira_configured: boolean;
  jira_webhook_secured: boolean;
  jira_account_count?: number;
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // "checking" = initial (no pill), "ok" = connected (no pill),
  // "offline" = at least one failure after first success (show pill).
  const [conn, setConn] = useState<"checking" | "ok" | "offline">("checking");

  // Validate stored token on mount
  useEffect(() => {
    if (!getToken()) {
      setAuthChecked(true);
      return;
    }

    auth
      .me()
      .then((u) => {
        setUser(u);
        setAuthChecked(true);
      })
      .catch(() => {
        clearToken();
        setAuthChecked(true);
      });
  }, []);

  function handleLogin() {
    auth
      .me()
      .then((u) => setUser(u))
      .catch(() => clearToken());
  }

  function handleLogout() {
    clearToken();
    setUser(null);
  }

  // ----- backend status -----
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function load() {
      try {
        const statusHeaders: Record<string, string> = {};
        if (API_BASE) statusHeaders["ngrok-skip-browser-warning"] = "true";
        // /api/status is now auth-required (org-scoped). Send the JWT.
        const token = getToken();
        if (token) statusHeaders["Authorization"] = `Bearer ${token}`;
        const r = await fetch(API_BASE + "/api/status", { headers: statusHeaders });

        if (!r.ok) {
          throw new Error(`status ${r.status}`);
        }

        const data = await r.json();

        if (!cancelled) {
          setStatus(data);
          setConn("ok");
        }
      } catch {
        if (!cancelled) {
          // Keep the last-known-good status visible. Only flip the connection
          // pill once we've actually tried at least once.
          setConn((prev) => (prev === "checking" ? "offline" : "offline"));
        }
      }
    }

    load();

    const t = setInterval(load, 30_000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user]);

  // ----- notification polling -----
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function tick() {
      try {
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

        const newAlerts = alerts.filter(
          (a) =>
            !a.read_at &&
            parseBackendTimestamp(a.created_at).getTime() >
              lsAlerts.getTime(),
        );

        setNotifs({
          alerts: newAlerts.length,
          changelog: countSince(changelog, lsChangelog, (f) => f.updated_at),
          deprecated: countSince(
            deprecated,
            lsDeprecated,
            (f) => f.updated_at,
          ),
          jira: countSince(runs, lsJira, (r) => r.started_at),
        });
      } catch {
        // ignore temporary network issues
      }
    }

    tick();

    const t = setInterval(tick, 30_000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user]);

  function selectTab(t: Tab, section: Section | null) {
    setTab(t);

    if (section) {
      markSeen(section);

      setNotifs((prev) => ({
        ...prev,
        [section]: 0,
      }));
    }
  }

  function badgeFor(section: Section | null): { count: number } | null {
    if (!section) return null;

    const c = section === "alerts" ? notifs.alerts : notifs[section];

    return c > 0 ? { count: c } : null;
  }

  // IMPORTANT:
  // Conditional returns MUST come AFTER all hooks.
  if (!authChecked) {
    return null;
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Pulse</h1>

        <div className="subtitle">Organizational memory</div>

        {TABS.filter((t) => !t.adminOnly || user.is_admin).map((t) => {
          const isActive = tab === t.id;
          const badge = !isActive ? badgeFor(t.section) : null;

          return (
            <div
              key={t.id}
              className={`nav-item ${isActive ? "active" : ""}`}
              data-tab={t.id}
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
          <div className="sidebar-status">
            <div className="sidebar-status-row">
              <span className="label">Model</span>
              <span className="value" title={status.model}>{status.model.replace("claude-", "")}</span>
            </div>
            <div className="sidebar-status-row">
              <span className="label">Claude</span>
              <span className={`value ${status.anthropic_configured ? "ok" : "bad"}`}>
                {status.anthropic_configured ? "live" : "stub"}
              </span>
            </div>
            <div className="sidebar-status-row">
              <span className="label">Vectors</span>
              <span className="value ok">pgvector</span>
            </div>
            <div className="sidebar-status-row">
              <span className="label">Jira</span>
              <span className={`value ${status.jira_configured ? "ok" : "bad"}`}>
                {status.jira_configured
                  ? `${status.jira_account_count ?? 1} acct${(status.jira_account_count ?? 1) === 1 ? "" : "s"}`
                  : "off"}
              </span>
            </div>
            <div className="sidebar-status-row">
              <span className="label">Webhook</span>
              <span className={`value ${status.jira_webhook_secured ? "ok" : "bad"}`}>
                {status.jira_webhook_secured ? "secured" : "unset"}
              </span>
            </div>
          </div>
        )}

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.username}</div>
          <div className="sidebar-user-role">{user.is_admin ? "Admin" : "Member"}</div>
          <button
            className="secondary"
            style={{ width: "100%", fontSize: 12 }}
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        {status !== null && status.anthropic_configured === false && user.is_admin && (
          // Admin-only banner — customers shouldn't see infrastructure jargon.
          // Stub mode is a setup state that only the org admin needs to act on.
          <div className="banner warn">
            <strong>Setup incomplete:</strong> Pulse can't connect to its AI provider.
            The agents will use a placeholder response until this is fixed —
            ask your administrator to complete the setup.
          </div>
        )}

        {conn === "offline" && (
          <div
            className="connection-pill"
            role="status"
            aria-live="polite"
            title="Pulse will keep trying automatically"
          >
            <span className="connection-dot" />
            <span>Reconnecting to Pulse…</span>
          </div>
        )}

        {tab === "search" && <SearchPanel />}
        {tab === "changelog" && <Changelog />}
        {tab === "deprecated" && <DeprecationList />}
        {tab === "alerts" && <AlertFeed />}
        {tab === "jira" && <JiraStatus />}
        {tab === "accounts" && user.is_admin && <JiraAccounts />}
      </main>
    </div>
  );
}