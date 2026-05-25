import { useEffect, useRef, useState } from "react";
import { api, AgentRun } from "../api";

type Turn = {
  role: "user" | "assistant";
  content: string;
  tool_calls?: AgentRun["tool_calls"];
};

const SUGGESTIONS = [
  "Does any team already have a Stripe payment retry?",
  "List all deprecated features and why they were deprecated",
  "Show me everything WebToffee owns",
  "Is there an OAuth or session-management system I can reuse?",
  "What's the cookie consent tooling we already have?",
];

export default function SearchPanel() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || loading) return;
    // Insert the user's turn and a fresh assistant turn we'll stream into.
    setTurns((t) => [
      ...t,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setLoading(true);
    try {
      await api.askStream(trimmed, (event) => {
        if (event.type === "text" && event.delta) {
          // Append the new chunk to the last (assistant) turn.
          setTurns((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, content: last.content + event.delta };
            }
            return next;
          });
        } else if (event.type === "done" && event.tool_calls) {
          setTurns((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, tool_calls: event.tool_calls };
            }
            return next;
          });
        }
      });
    } catch (e) {
      setTurns((t) => {
        const next = [...t];
        const last = next[next.length - 1];
        const errMsg = `Error: ${e instanceof Error ? e.message : String(e)}`;
        if (last && last.role === "assistant" && !last.content) {
          next[next.length - 1] = { ...last, content: errMsg };
        } else {
          next.push({ role: "assistant", content: errMsg });
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await send(input);
  }

  return (
    <>
      <h2>Ask Pulse</h2>
      <p className="page-sub">
        Ask in plain English. A Claude agent reads the question, picks the right tools
        (semantic search, list-by-filter, fetch-feature-details), and writes you an answer.
      </p>

      <div
        ref={scrollRef}
        className="card"
        style={{
          minHeight: 200,
          maxHeight: "55vh",
          overflowY: "auto",
          padding: turns.length === 0 ? 18 : 8,
        }}
      >
        {turns.length === 0 && (
          <div style={{ color: "var(--muted)" }}>
            <p style={{ marginTop: 0 }}>Try one of these:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="secondary"
                  style={{ textAlign: "left", width: "fit-content" }}
                  onClick={() => send(s)}
                  disabled={loading}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div
            key={i}
            style={{
              margin: "10px 0",
              padding: "10px 14px",
              borderRadius: 8,
              background: turn.role === "user" ? "var(--panel-2)" : "rgba(91,140,255,0.08)",
              border: turn.role === "assistant" ? "1px solid rgba(91,140,255,0.25)" : "1px solid var(--border)",
            }}
          >
            <div
              className="muted"
              style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}
            >
              {turn.role === "user" ? "You" : "Pulse"}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{turn.content}</div>
            {turn.tool_calls && turn.tool_calls.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
                  {turn.tool_calls.length} tool call{turn.tool_calls.length === 1 ? "" : "s"}
                </summary>
                {turn.tool_calls.map((tc, j) => (
                  <div className="tool-call" key={j}>
                    <strong>{tc.tool}</strong>
                    {tc.is_error && <span className="badge high" style={{ marginLeft: 8 }}>error</span>}
                    {"\n"}
                    input: {JSON.stringify(tc.input).slice(0, 200)}
                    {"\n"}
                    result: {JSON.stringify(tc.result).slice(0, 240)}
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}

        {loading && turns[turns.length - 1]?.role === "assistant" && !turns[turns.length - 1]?.content && (
          <div className="muted" style={{ padding: "10px 14px" }}>
            <em>Pulse is thinking…</em>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about features, deprecations, or overlap across products…"
            disabled={loading}
            style={{ flex: 1 }}
          />
          <button disabled={loading || !input.trim()}>{loading ? "..." : "Send"}</button>
          {turns.length > 0 && (
            <button type="button" className="secondary" onClick={() => setTurns([])} disabled={loading}>
              Clear
            </button>
          )}
        </div>
      </form>
    </>
  );
}
