import { useEffect, useState } from "react";
import { auth, setToken } from "../api";

export default function VerifyEmail() {
  const [state, setState] = useState<"verifying" | "success" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      setError("No verification token found in the link.");
      return;
    }

    auth.verifyEmail(token)
      .then(({ access_token }) => {
        setToken(access_token);
        setState("success");
        // Redirect to app after short delay
        setTimeout(() => {
          window.location.href = "/";
        }, 2000);
      })
      .catch((err) => {
        setState("error");
        setError(err instanceof Error ? err.message : "Verification failed.");
      });
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg)",
    }}>
      <div style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "40px 48px",
        width: 380,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        textAlign: "center",
      }}>
        {state === "verifying" && (
          <>
            <div style={{ fontSize: 40 }}>⏳</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Verifying your email…</h2>
              <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 14 }}>
                Just a moment.
              </p>
            </div>
          </>
        )}

        {state === "success" && (
          <>
            <div style={{ fontSize: 40 }}>✅</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Email verified!</h2>
              <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 14 }}>
                Your account is active. Taking you to Pulse…
              </p>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <div style={{ fontSize: 40 }}>❌</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Verification failed</h2>
              <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 14 }}>
                {error}
              </p>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>
                The link may have expired (24h) or already been used.
              </p>
            </div>
            <button onClick={() => { window.location.href = "/"; }}>
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
