import { useEffect, useState } from "react";
import { AgentRun, api, Project } from "../api";
import { formatISTDateTime } from "../utils/datetime";

export default function JiraStatus() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function load() {
    try {
      const [r, p] = await Promise.all([api.agentRuns(20), api.projects()]);
      setRuns(r);
      setProjects(p);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  async function saveOverride(key: string) {
    if (!editValue.trim()) return;
    await api.setProductGroup(key, editValue.trim());
    setEditingKey(null);
    setEditValue("");
    load();
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await api.syncProjects();

      // Build per-account feedback so we don't lie when one connection is broken.
      const accounts = result.accounts || [];
      const failed = accounts.filter((a) => a.error);
      const succeeded = accounts.filter((a) => !a.error);

      if (accounts.length === 0) {
        // No active Jira accounts in this org — guide the user to connect one.
        setSyncMessage("No Jira workspace is connected yet. Add one in Jira Accounts to start tracking projects.");
      } else if (failed.length === accounts.length) {
        // Every account failed — give the actual reason from the first one.
        const a = failed[0];
        setSyncMessage(`Couldn't reach “${a.account_label}”: ${friendlySyncError(a)}. Check the connection in Jira Accounts.`);
      } else if (failed.length > 0) {
        // Mixed: some good, some bad.
        const okStr = result.new_projects.length
          ? `Added ${result.new_projects.join(", ")} from ${succeeded.length} workspace(s)`
          : `${succeeded.length} workspace(s) up to date`;
        const failedNames = failed.map((a) => `“${a.account_label}”`).join(", ");
        setSyncMessage(`${okStr}. Failed: ${failedNames} — check Jira Accounts.`);
      } else {
        // All succeeded. Be honest whether anything changed.
        const parts: string[] = [];
        if (result.new_projects.length) parts.push(`Added ${result.new_projects.join(", ")}`);
        if (result.deleted_projects.length) parts.push(`Removed ${result.deleted_projects.join(", ")} (no longer in Jira)`);
        setSyncMessage(parts.length ? parts.join(" · ") : "Up to date — nothing new in Jira since the last check.");
      }
      load();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setSyncMessage(`Sync didn't complete: ${m}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <h2>Jira & Agents</h2>
      <p className="page-sub">
        Live view of what Pulse is doing as your Jira tickets move through the workflow.
      </p>

      <div className="banner">
        <strong>How this works:</strong> Pulse listens for ticket events from your connected Jira
        workspaces and runs AI agents to spot duplicates, deprecations, and cross-team overlap.
        <div className="muted" style={{ marginTop: 6 }}>
          New projects are discovered automatically the first time a ticket is created in them.
          You can manually trigger a project refresh with the button below.
        </div>
      </div>

      <div className="row" style={{ marginTop: 24, alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>Registered projects</h3>
        <div className="spacer" />
        <button
          className="secondary"
          onClick={syncNow}
          disabled={syncing}
          title="Pull every project from Jira right now"
        >
          {syncing ? "Syncing…" : "Sync from Jira"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        Auto-discovered from Jira on a background poll — new spaces appear here as soon as
        they're created in Jira, and spaces deleted from Jira are removed on the next sync.
        Click <em>Edit</em> to override the inferred product group (also migrates every ticket
        and feature under the project).
      </p>
      {syncMessage && (
        <div className="banner" style={{ marginBottom: 12, fontSize: 13 }}>
          {syncMessage}
        </div>
      )}
      {projects.length === 0 && (
        <div className="empty">
          No projects yet. Hit <em>Sync from Jira</em> above, or wait for the next background poll.
        </div>
      )}
      {projects.map((p) => (
        <div className="card" key={p.key}>
          <div className="row">
            <strong>{p.key}</strong>
            <span className="muted">{p.name}</span>
            <div className="spacer" />
            {p.jira_account_label && (
              <span
                className="badge"
                title={`Jira account: ${p.jira_account_label}`}
                style={{ opacity: 0.85 }}
              >
                @ {p.jira_account_label}
              </span>
            )}
            <span className="badge">{p.product_group || "(unset)"}</span>
            {p.is_inferred ? (
              <span className="badge" title="Inferred by Claude">inferred</span>
            ) : (
              <span className="badge active" title="Manually overridden">manual</span>
            )}
            <button
              className="secondary"
              onClick={() => {
                setEditingKey(p.key);
                setEditValue(p.product_group);
              }}
            >
              Edit
            </button>
          </div>
          {editingKey === p.key && (
            <div className="row" style={{ marginTop: 10 }}>
              <input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="Product group label"
                style={{ flex: 1 }}
              />
              <button onClick={() => saveOverride(p.key)}>Save</button>
              <button
                className="secondary"
                onClick={() => {
                  setEditingKey(null);
                  setEditValue("");
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {p.description && (
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              {p.description.slice(0, 240)}
            </div>
          )}
        </div>
      ))}

      <h3 style={{ marginTop: 32 }}>Recent agent runs</h3>
      {loading && <div className="empty">Loading agent runs…</div>}
      {!loading && runs.length === 0 && (
        <div className="empty">
          No agent runs yet. Create or transition a Jira ticket and the webhook will fire.
        </div>
      )}
      {runs.map((r) => (
        <div className="card" key={r.id}>
          <div className="row">
            <span className="badge">{r.agent}</span>
            {r.ticket_key && <span className="badge">{r.ticket_key}</span>}
            <div className="spacer" />
            <span className="muted">{formatISTDateTime(r.started_at)}</span>
          </div>
          {r.output_summary && (
            <p style={{ marginTop: 10, marginBottom: 6, whiteSpace: "pre-wrap" }}>{r.output_summary}</p>
          )}
          {r.tool_calls.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
                {r.tool_calls.length} tool call{r.tool_calls.length === 1 ? "" : "s"}
              </summary>
              {r.tool_calls.map((tc, i) => (
                <div className="tool-call" key={i}>
                  <strong>{tc.tool}</strong>
                  {tc.is_error && <span className="badge high" style={{ marginLeft: 8 }}>error</span>}
                  {"\n"}
                  input: {JSON.stringify(tc.input).slice(0, 220)}
                  {"\n"}
                  result: {JSON.stringify(tc.result).slice(0, 240)}
                </div>
              ))}
            </details>
          )}
        </div>
      ))}
    </>
  );
}

/** Convert a per-account sync failure into something a customer can act on. */
function friendlySyncError(a: { status?: string; error?: string }): string {
  switch (a.status) {
    case "auth_failed": return "the API token isn't accepted anymore (it may have expired)";
    case "not_found":   return "the Base URL doesn't point to a Jira workspace";
    case "unreachable": return "Atlassian is unreachable right now";
    default:            return a.error || "the connection check failed";
  }
}
