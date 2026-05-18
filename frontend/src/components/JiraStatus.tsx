import { useEffect, useState } from "react";
import { AgentRun, api, Project } from "../api";
import { formatISTDateTime } from "../utils/datetime";

export default function JiraStatus() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function saveOverride(key: string) {
    if (!editValue.trim()) return;
    await api.setProductGroup(key, editValue.trim());
    setEditingKey(null);
    setEditValue("");
    load();
  }

  return (
    <>
      <h2>Jira & Agents</h2>
      <p className="page-sub">
        Real-time view of agent runs triggered by Jira webhooks. Polls every 4 seconds.
      </p>

      <div className="banner">
        <strong>Webhook endpoint:</strong> <code>POST /jira/webhook?token=&lt;JIRA_WEBHOOK_SECRET&gt;</code>
        <div className="muted" style={{ marginTop: 6 }}>
          Configure this URL in Atlassian → Jira settings → System → Webhooks. Point it at your
          ngrok HTTPS tunnel. Projects are auto-discovered — no allowlist.
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>Registered projects</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Auto-registered the first time Pulse receives a webhook from each project. Claude assigns the
        product group from Jira's project name + description. Click <em>Edit</em> to override.
      </p>
      {projects.length === 0 && (
        <div className="empty">
          No projects yet. They'll appear here automatically the first time a webhook fires.
        </div>
      )}
      {projects.map((p) => (
        <div className="card" key={p.key}>
          <div className="row">
            <strong>{p.key}</strong>
            <span className="muted">{p.name}</span>
            <div className="spacer" />
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
