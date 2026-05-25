import { useState } from "react";
import { auth, setToken } from "../api";

export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (!token) {
      setError("No reset token found in the link.");
      return;
    }
    setLoading(true);
    try {
      const { access_token } = await auth.resetPassword(token, password);
      setToken(access_token);
      setDone(true);
      setTimeout(() => { window.location.href = "/"; }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "40px 48px", width: 400, display: "flex", flexDirection: "column", gap: 20 }}>
        {done ? (
          <>
            <div style={{ fontSize: 40, textAlign: "center" }}>✅</div>
            <h2 style={{ margin: 0, fontSize: 20, textAlign: "center" }}>Password updated</h2>
            <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 14, textAlign: "center" }}>
              Signing you in…
            </p>
          </>
        ) : (
          <>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Choose a new password</h1>
              <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
                Pick something at least 8 characters long.
              </p>
            </div>
            {error && <div className="banner warn" style={{ marginBottom: 0, fontSize: 13 }}>{error}</div>}
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>New password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} disabled={loading} placeholder="At least 8 characters" autoComplete="new-password" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Confirm new password</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} disabled={loading} placeholder="Re-enter it" autoComplete="new-password" />
              </div>
              <button type="submit" disabled={loading || !password || !confirm} style={{ marginTop: 4 }}>
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
              <button type="button" onClick={() => { window.location.href = "/"; }} style={{ background: "none", border: "none", color: "var(--accent, #4f8bff)", cursor: "pointer", padding: 0, fontSize: 13 }}>
                Back to sign in
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
