import { useEffect, useState } from "react";
import { api, Feature } from "../api";

export default function DeprecationList() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.features("deprecated").then((f) => {
      setFeatures(f);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="empty">Loading...</div>;

  return (
    <>
      <h2>Deprecated Features</h2>
      <p className="page-sub">Permanent record. Future duplicate searches will surface these.</p>

      {features.length === 0 && <div className="empty">Nothing deprecated yet.</div>}

      {features.map((f) => (
        <div className="card" key={f.id}>
          <div className="row">
            <strong>{f.name}</strong>
            <span className="badge deprecated">deprecated</span>
            <span className="badge">{f.product_group}</span>
            {f.team && f.team !== "Unknown" && <span className="badge">{f.team}</span>}
          </div>
          <p style={{ marginTop: 10, marginBottom: 6 }}>{f.summary}</p>
          {f.deprecation_reason && (
            <div className="banner warn" style={{ marginTop: 10, marginBottom: 0 }}>
              <strong>Reason:</strong> {f.deprecation_reason}
            </div>
          )}
          {f.ticket_key && (
            <div className="muted" style={{ marginTop: 8 }}>From: {f.ticket_key}</div>
          )}
        </div>
      ))}
    </>
  );
}
