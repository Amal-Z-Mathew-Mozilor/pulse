import { useEffect, useState } from "react";
import { api, Feature } from "../api";
import { formatISTDateTime } from "../utils/datetime";

export default function Changelog() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.changelog().then((f) => {
      setFeatures(f);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="empty">Loading...</div>;

  return (
    <>
      <h2>Changelog</h2>
      <p className="page-sub">Auto-generated from completed Jira tickets by the Documentation Agent.</p>

      {features.length === 0 && (
        <div className="empty">
          No changelog entries yet. Trigger a "Done" event in the Simulator to generate one.
        </div>
      )}

      {features.map((f) => (
        <div className="card" key={f.id}>
          <div className="row">
            <strong>{f.name}</strong>
            <span className={`badge ${f.status}`}>{f.status}</span>
            <span className="badge">{f.product_group}</span>
            {f.team && f.team !== "Unknown" && <span className="badge">{f.team}</span>}
            <div className="spacer" />
            <span className="muted">{formatISTDateTime(f.updated_at)}</span>
          </div>
          <p style={{ marginTop: 10, marginBottom: 8 }}>{f.summary}</p>
          {f.changelog && <div className="tool-call">{f.changelog}</div>}
          {f.ticket_key && <div className="muted" style={{ marginTop: 8 }}>From: {f.ticket_key}</div>}
        </div>
      ))}
    </>
  );
}
