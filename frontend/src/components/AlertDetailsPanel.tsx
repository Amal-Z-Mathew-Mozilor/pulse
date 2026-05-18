import { useEffect, useState } from "react";
import { api, RelatedFeature } from "../api";
import { formatISTDate } from "../utils/datetime";

type Props = { alertId: number };

type FetchState =
  | { kind: "loading" }
  | { kind: "ok"; data: RelatedFeature[] }
  | { kind: "error"; message: string };

// Similarity-score tiers (per design spec)
function scoreTier(score: number | null): "high" | "mid" | "low" | null {
  if (score === null) return null;
  if (score >= 0.75) return "high";
  if (score >= 0.55) return "mid";
  return "low";
}

export default function AlertDetailsPanel({ alertId }: Props) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .alertRelatedFeatures(alertId)
      .then((data) => {
        if (!cancelled) setState({ kind: "ok", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setState({ kind: "error", message: msg });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [alertId]);

  if (state.kind === "loading") {
    return (
      <div className="details-panel">
        <div className="muted" style={{ padding: 8 }}>
          Loading related features…
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="details-panel">
        <div className="banner warn" style={{ margin: 0 }}>
          <strong>Couldn't load related features.</strong> {state.message}
        </div>
      </div>
    );
  }

  const items = state.data;

  return (
    <div className="details-panel">
      <SectionHeader count={items.length} />
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        items.map((rf) => <RelatedFeatureCard key={rf.feature.id} rf={rf} />)
      )}
    </div>
  );
}

// ------------ subcomponents ------------

function SectionHeader({ count }: { count: number }) {
  return (
    <div className="details-section-header">
      <ChainIcon size={12} />
      <span>Related Features · {count}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="details-empty">
      <BrokenLinkIcon size={28} />
      <div>
        <div style={{ fontWeight: 600, color: "var(--text)" }}>No related features to display.</div>
        <div style={{ marginTop: 4 }}>
          The alert references tickets, but none have a feature record yet.
        </div>
      </div>
    </div>
  );
}

function RelatedFeatureCard({ rf }: { rf: RelatedFeature }) {
  const { feature, similarity_score, open_in_jira_url } = rf;
  const isDeprecated = feature.status === "deprecated";
  const tier = scoreTier(similarity_score);
  const scorePct = similarity_score !== null ? Math.round(similarity_score * 100) : null;

  return (
    <div className={`related-card ${isDeprecated ? "is-deprecated" : "is-active"}`}>
      <div className="related-card__title-row">
        {feature.ticket_key && <span className="ticket-key-pill">{feature.ticket_key}</span>}
        {isDeprecated && <span className="deprecated-indicator">⚠ Deprecated</span>}
      </div>

      <div className="related-card__summary">{feature.name}</div>

      <div className="related-card__badges">
        <span className={`badge ${feature.status}`}>{feature.status}</span>
        {feature.product_group && <span className="badge">{feature.product_group}</span>}
        {feature.team && feature.team !== "Unknown" && <span className="badge">{feature.team}</span>}
      </div>

      {tier !== null && scorePct !== null && (
        <div className="score-row">
          <span className="score-row__label">Similarity</span>
          <div className="score-bar" aria-label={`similarity ${scorePct}%`}>
            <div className={`score-bar-fill ${tier}`} style={{ width: `${scorePct}%` }} />
          </div>
          <span className={`score-pct ${tier}`}>{scorePct}%</span>
        </div>
      )}

      <p className="related-card__description">{feature.summary}</p>

      {isDeprecated && feature.deprecation_reason && (
        <div className="banner warn" style={{ margin: 0 }}>
          <strong>⚠ DEPRECATED —</strong> {feature.deprecation_reason}
        </div>
      )}

      <div className="related-card__footer">
        <div className="related-card__meta">
          Updated {formatISTDate(feature.updated_at)}
        </div>
        {open_in_jira_url && (
          <a
            href={open_in_jira_url}
            target="_blank"
            rel="noopener noreferrer"
            className="open-in-jira"
            title="Open in Jira"
          >
            <span>Open in Jira</span>
            <ExternalLinkIcon size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

// ------------ inline SVGs (themed via currentColor) ------------

function ChainIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function BrokenLinkIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 17l-3 3a4 4 0 0 1-5.66-5.66l3-3" />
      <path d="M15 7l3-3a4 4 0 0 1 5.66 5.66l-3 3" opacity="0.6" />
      <path d="M8 8l8 8" />
      <path d="M12 4v3" />
      <path d="M4 12h3" />
      <path d="M12 20v-3" />
      <path d="M20 12h-3" />
    </svg>
  );
}

function ExternalLinkIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
