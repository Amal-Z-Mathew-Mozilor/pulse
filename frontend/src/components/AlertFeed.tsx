import { useEffect, useMemo, useState } from "react";
import { Alert, api } from "../api";
import { formatISTDateTime } from "../utils/datetime";
import AlertDetailsPanel from "./AlertDetailsPanel";

type FilterMode = "all" | "unread" | "read";

export default function AlertFeed() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<Set<number>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("unread");

  // For pending_deprecation alerts: which candidate ticket keys are selected per alert.
  // null means "not yet initialized"; once initialized, we default-select every candidate.
  const [pendingSelections, setPendingSelections] = useState<Map<number, Set<string>>>(new Map());

  async function load() {
    const a = await api.alerts();
    setAlerts(a);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Lazily seed pendingSelections with all candidate keys checked on first sight.
  useEffect(() => {
    setPendingSelections((prev) => {
      let mutated = false;
      const next = new Map(prev);
      for (const a of alerts) {
        if (a.type !== "pending_deprecation") continue;
        if (a.approval_state !== "pending") continue;
        if (next.has(a.id)) continue;
        const keys = (a.related_features || [])
          .map((r) => r.ticket_key)
          .filter((k): k is string => !!k);
        next.set(a.id, new Set(keys));
        mutated = true;
      }
      return mutated ? next : prev;
    });
  }, [alerts]);

  async function markRead(id: number) {
    // Optimistic update so the read-state flip is instant, like Gmail.
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, read_at: a.read_at || new Date().toISOString() } : a)),
    );
    try {
      await api.markAlertRead(id);
    } catch {
      load(); // re-sync on failure
    }
  }

  async function deleteAlert(id: number) {
    setError(null);
    setBusy((s) => new Set(s).add(id));
    try {
      await api.deleteAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      setConfirming((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      setExpanded((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes("405") || msg.includes("404")
          ? "Couldn't delete that alert — Pulse is updating. Please refresh in a moment."
          : "Couldn't delete that alert. Please try again.",
      );
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function clearAllRead() {
    setError(null);
    setBulkBusy(true);
    try {
      await api.clearReadAlerts();
      setBulkConfirming(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes("405") || msg.includes("404")
          ? "Couldn't clear those alerts — Pulse is updating. Please refresh in a moment."
          : "Couldn't clear those alerts. Please try again.",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function approve(alertId: number, scope: "selected" | "all") {
    setError(null);
    setBusy((s) => new Set(s).add(alertId));
    try {
      const keys =
        scope === "all"
          ? null
          : Array.from(pendingSelections.get(alertId) || []);
      await api.approveAlert(alertId, keys);
      await load();
    } catch (e) {
      setError(`Approve failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(alertId);
        return n;
      });
    }
  }

  async function reject(alertId: number) {
    setError(null);
    setBusy((s) => new Set(s).add(alertId));
    try {
      await api.rejectAlert(alertId, "Rejected via Alert Feed.");
      await load();
    } catch (e) {
      setError(`Reject failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(alertId);
        return n;
      });
    }
  }

  function toggleCandidate(alertId: number, key: string) {
    setPendingSelections((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(alertId) || []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next.set(alertId, set);
      return next;
    });
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Gmail/Slack pattern: opening an alert marks it as read automatically.
    const alert = alerts.find((a) => a.id === id);
    if (alert && !alert.read_at) {
      void markRead(id);
    }
  }

  function startConfirmDelete(id: number) {
    setConfirming((s) => new Set(s).add(id));
  }
  function cancelConfirmDelete(id: number) {
    setConfirming((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  const readCount = useMemo(() => alerts.filter((a) => a.read_at).length, [alerts]);
  const unreadCount = useMemo(() => alerts.filter((a) => !a.read_at).length, [alerts]);

  // Apply the read/unread filter.
  const filtered = useMemo(() => {
    if (filter === "unread") return alerts.filter((a) => !a.read_at);
    if (filter === "read") return alerts.filter((a) => !!a.read_at);
    return alerts;
  }, [alerts, filter]);

  async function markAllRead() {
    const unread = alerts.filter((a) => !a.read_at);
    if (unread.length === 0) return;
    // Optimistic update first, then fire requests in parallel.
    const now = new Date().toISOString();
    setAlerts((prev) =>
      prev.map((a) => (a.read_at ? a : { ...a, read_at: now })),
    );
    await Promise.allSettled(unread.map((a) => api.markAlertRead(a.id)));
  }

  if (loading) return <div className="empty">Loading...</div>;

  return (
    <>
      <h2>Alert Feed</h2>
      <p className="page-sub">
        Smart alerts emitted by agents. {unreadCount > 0 && (
          <strong style={{ color: "var(--accent)" }}>
            {unreadCount} unread
          </strong>
        )}
      </p>

      {error && (
        <div className="banner warn" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button className="link-button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="row" style={{ marginBottom: 16, alignItems: "center" }}>
        <div className="alert-filter" role="tablist" aria-label="Filter alerts">
          <button
            className={filter === "unread" ? "active" : ""}
            onClick={() => setFilter("unread")}
            role="tab"
          >
            Unread <span className="count">{unreadCount}</span>
          </button>
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
            role="tab"
          >
            All <span className="count">{alerts.length}</span>
          </button>
          <button
            className={filter === "read" ? "active" : ""}
            onClick={() => setFilter("read")}
            role="tab"
          >
            Read <span className="count">{readCount}</span>
          </button>
        </div>

        <div className="spacer" />

        {unreadCount > 0 && (
          <button
            className="link-button"
            onClick={markAllRead}
            style={{ fontSize: 12 }}
          >
            Mark all as read
          </button>
        )}

        {readCount > 0 && (
          !bulkConfirming ? (
            <button
              className="link-button danger"
              onClick={() => setBulkConfirming(true)}
              disabled={bulkBusy}
              style={{ fontSize: 12 }}
            >
              Clear read ({readCount})
            </button>
          ) : (
            <>
              <span className="muted" style={{ fontSize: 12 }}>
                Delete {readCount}?
              </span>
              <button
                className="link-button danger"
                onClick={clearAllRead}
                disabled={bulkBusy}
                style={{ fontSize: 12 }}
              >
                {bulkBusy ? "…" : "Confirm"}
              </button>
              <button
                className="link-button"
                onClick={() => setBulkConfirming(false)}
                disabled={bulkBusy}
                style={{ fontSize: 12 }}
              >
                Cancel
              </button>
            </>
          )
        )}
      </div>

      {filtered.length === 0 && (
        <div className="empty">
          {filter === "unread"
            ? "✨ You're all caught up — no unread alerts."
            : filter === "read"
            ? "No alerts have been read yet."
            : "No alerts. Pulse will create them when the agents find duplicates, deprecations, or cross-product overlap."}
        </div>
      )}

      {filtered.map((a) => {
        if (a.type === "pending_deprecation") {
          return (
            <PendingDeprecationCard
              key={a.id}
              alert={a}
              selected={pendingSelections.get(a.id) || new Set()}
              onToggle={(k) => toggleCandidate(a.id, k)}
              onApprove={(scope) => approve(a.id, scope)}
              onReject={() => reject(a.id)}
              busy={busy.has(a.id)}
            />
          );
        }
        if (a.type === "cross_product_consideration") {
          return (
            <CrossProductCard
              key={a.id}
              alert={a}
              isOpen={expanded.has(a.id)}
              isConfirming={confirming.has(a.id)}
              isBusy={busy.has(a.id)}
              onToggleExpand={() => toggleExpand(a.id)}
              onMarkRead={() => markRead(a.id)}
              onStartConfirmDelete={() => startConfirmDelete(a.id)}
              onCancelConfirmDelete={() => cancelConfirmDelete(a.id)}
              onDelete={() => deleteAlert(a.id)}
            />
          );
        }
        return (
          <StandardAlertCard
            key={a.id}
            alert={a}
            isOpen={expanded.has(a.id)}
            isConfirming={confirming.has(a.id)}
            isBusy={busy.has(a.id)}
            onToggleExpand={() => toggleExpand(a.id)}
            onMarkRead={() => markRead(a.id)}
            onStartConfirmDelete={() => startConfirmDelete(a.id)}
            onCancelConfirmDelete={() => cancelConfirmDelete(a.id)}
            onDelete={() => deleteAlert(a.id)}
          />
        );
      })}
    </>
  );

}

// ------- Standard alert card (everything except pending_deprecation) -------

function StandardAlertCard(props: {
  alert: Alert;
  isOpen: boolean;
  isConfirming: boolean;
  isBusy: boolean;
  onToggleExpand: () => void;
  onMarkRead: () => void;
  onStartConfirmDelete: () => void;
  onCancelConfirmDelete: () => void;
  onDelete: () => void;
}) {
  const { alert: a, isOpen, isConfirming, isBusy } = props;
  const isUnread = !a.read_at;
  return (
    <div className={`card ${isUnread ? "alert-unread" : "alert-read"}`}>
      <div className="row">
        {isUnread && <span className="unread-dot" aria-label="unread" />}
        <strong>{a.title}</strong>
        <span className={`badge ${a.type}`}>{a.type.replaceAll("_", " ")}</span>
        <span className={`badge ${a.severity}`}>{a.severity}</span>
        <span className={`alert-state-tag ${isUnread ? "unread" : "read"}`}>
          {isUnread ? "NEW" : "READ"}
        </span>
        <div className="spacer" />
        <span className="muted">{formatISTDateTime(a.created_at)}</span>
      </div>
      <p style={{ marginTop: 10, marginBottom: 8, whiteSpace: "pre-wrap" }}>{a.message}</p>
      <div className="row">
        {a.ticket_key && <span className="muted">Ticket: {a.ticket_key}</span>}
        <div className="spacer" />
        {!isConfirming ? (
          <>
            <button className="secondary" onClick={props.onToggleExpand}>
              {isOpen ? "Hide Details" : "View Details"}
            </button>
            {!a.read_at && (
              <button className="secondary" onClick={props.onMarkRead} title="Mark this alert as read">
                Mark read
              </button>
            )}
            <button
              className="icon-button danger"
              onClick={props.onStartConfirmDelete}
              aria-label="Delete alert"
              title="Delete alert"
              disabled={isBusy}
            >
              <TrashIcon size={14} />
            </button>
          </>
        ) : (
          <>
            <span className="muted">Delete this alert?</span>
            <button className="secondary danger" onClick={props.onDelete} disabled={isBusy}>
              {isBusy ? "Deleting…" : "Delete"}
            </button>
            <button
              className="secondary"
              onClick={props.onCancelConfirmDelete}
              disabled={isBusy}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {isOpen && <AlertDetailsPanel alertId={a.id} />}
    </div>
  );
}

// ------- pending_deprecation card with checkbox approval UI -------

function PendingDeprecationCard(props: {
  alert: Alert;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onApprove: (scope: "selected" | "all") => void;
  onReject: () => void;
  busy: boolean;
}) {
  const { alert: a, selected, onToggle, onApprove, onReject, busy } = props;
  const isResolved = a.approval_state === "resolved";
  const isRejected = a.approval_state === "rejected";
  const isActionable = a.approval_state === "pending";

  const candidates = a.related_features || [];

  return (
    <div
      className="card pending-deprecation-card"
      style={{ opacity: isResolved || isRejected ? 0.75 : 1 }}
    >
      <div className="row">
        <strong>{a.title}</strong>
        <span className="badge pending_deprecation">pending deprecation</span>
        <span className={`badge ${a.severity}`}>{a.severity}</span>
        {isResolved && <span className="badge active">resolved</span>}
        {isRejected && <span className="badge deprecated">rejected</span>}
        <div className="spacer" />
        <span className="muted">{formatISTDateTime(a.created_at)}</span>
      </div>

      <p style={{ marginTop: 10, marginBottom: 8, whiteSpace: "pre-wrap" }}>{a.message}</p>

      {isActionable && candidates.length > 0 && (
        <div className="pending-candidates">
          <div className="pending-candidates__header">
            Candidate features — check the ones to deprecate:
          </div>
          {candidates.map((rf) => {
            const key = rf.ticket_key;
            if (!key) return null;
            const checked = selected.has(key);
            return (
              <label className="pending-candidate" key={key}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(key)}
                  disabled={busy}
                />
                <span className="ticket-key-pill">{key}</span>
                {typeof rf.similarity_score === "number" && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    similarity {(rf.similarity_score * 100).toFixed(0)}%
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {(isResolved || isRejected) && a.action_log?.length > 0 && (
        <div className="banner" style={{ marginTop: 10, marginBottom: 0 }}>
          <strong>Action taken:</strong>{" "}
          {a.action_log[a.action_log.length - 1]?.action.replaceAll("_", " ")}
          {" — "}
          {formatISTDateTime(a.action_log[a.action_log.length - 1]?.at)}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        {a.ticket_key && <span className="muted">Triggering ticket: {a.ticket_key}</span>}
        <div className="spacer" />
        {isActionable && (
          <>
            <button
              onClick={() => onApprove("selected")}
              disabled={busy || selected.size === 0}
            >
              {busy ? "Working…" : `Approve selected (${selected.size})`}
            </button>
            <button className="secondary" onClick={() => onApprove("all")} disabled={busy}>
              Approve all
            </button>
            <button className="secondary danger" onClick={onReject} disabled={busy}>
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ------- cross_product_consideration card (informational, FYI only) -------

function CrossProductCard(props: {
  alert: Alert;
  isOpen: boolean;
  isConfirming: boolean;
  isBusy: boolean;
  onToggleExpand: () => void;
  onMarkRead: () => void;
  onStartConfirmDelete: () => void;
  onCancelConfirmDelete: () => void;
  onDelete: () => void;
}) {
  const { alert: a, isOpen, isConfirming, isBusy } = props;
  const isUnread = !a.read_at;
  return (
    <div className={`card cross-product-card ${isUnread ? "alert-unread" : "alert-read"}`}>
      <div className="row">
        {isUnread && <span className="unread-dot" aria-label="unread" />}
        <span className="cross-product-card__fyi-pill">FYI</span>
        <strong>{a.title}</strong>
        <span className="badge cross_product_consideration">cross product</span>
        <span className="badge info-soft">info</span>
        <span className={`alert-state-tag ${isUnread ? "unread" : "read"}`}>
          {isUnread ? "NEW" : "READ"}
        </span>
        <div className="spacer" />
        <span className="muted">{formatISTDateTime(a.created_at)}</span>
      </div>
      <div className="banner" style={{ marginTop: 10, marginBottom: 0 }}>
        <strong>Cross-product consideration:</strong>{" "}
        informational only — the owning product team decides. No automatic
        action was taken.
      </div>
      <p style={{ marginTop: 10, marginBottom: 8, whiteSpace: "pre-wrap" }}>{a.message}</p>
      <div className="row">
        {a.ticket_key && <span className="muted">Triggering ticket: {a.ticket_key}</span>}
        <div className="spacer" />
        {!isConfirming ? (
          <>
            <button className="secondary" onClick={props.onToggleExpand}>
              {isOpen ? "Hide Details" : "View Details"}
            </button>
            {!a.read_at && (
              <button className="secondary" onClick={props.onMarkRead}>
                Mark read
              </button>
            )}
            <button
              className="icon-button danger"
              onClick={props.onStartConfirmDelete}
              aria-label="Delete alert"
              title="Delete alert"
              disabled={isBusy}
            >
              <TrashIcon size={14} />
            </button>
          </>
        ) : (
          <>
            <span className="muted">Delete this alert?</span>
            <button className="secondary danger" onClick={props.onDelete} disabled={isBusy}>
              {isBusy ? "Deleting…" : "Delete"}
            </button>
            <button
              className="secondary"
              onClick={props.onCancelConfirmDelete}
              disabled={isBusy}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {isOpen && <AlertDetailsPanel alertId={a.id} />}
    </div>
  );
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
