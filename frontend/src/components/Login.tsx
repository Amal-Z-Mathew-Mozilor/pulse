import { useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { auth, setToken } from "../api";

const GOOGLE_ENABLED = !!(import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined);

type Mode = "signin" | "create_workspace" | "join_workspace" | "forgot";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPendingEmail(null);
    setResetSent(false);
  }

  async function handleGoogleAccessToken(accessToken: string) {
    setError(null);
    setLoading(true);
    try {
      const { access_token } = await auth.googleLogin(accessToken);
      setToken(access_token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  const googleLogin = useGoogleLogin({
    onSuccess: (response) => handleGoogleAccessToken(response.access_token),
    onError: () => setError("Google sign-in was cancelled or failed"),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { access_token } = await auth.login(identifier, password);
        setToken(access_token);
        onLogin();
      } else if (mode === "create_workspace") {
        const result = await auth.signup(username, email, password, "create", companyName);
        setPendingEmail(result.email);
      } else if (mode === "join_workspace") {
        const result = await auth.signup(username, email, password, "join");
        setPendingEmail(result.email);
      } else {
        await auth.forgotPassword(email);
        setResetSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const googleBlock = GOOGLE_ENABLED ? (
    <div className="login-google">
      <div className="login-divider"><span>or</span></div>
      <button
        type="button"
        className="login-google-btn"
        onClick={() => googleLogin()}
        disabled={loading}
      >
        <GoogleIcon />
        <span>Continue with Google</span>
      </button>
    </div>
  ) : null;

  // ---- Confirmation screens ----

  if (pendingEmail) {
    return (
      <Shell>
        <div className="login-icon-circle">📬</div>
        <h2 className="login-heading">Check your email</h2>
        <p className="login-sub">
          We sent a verification link to<br />
          <strong style={{ color: "var(--text)" }}>{pendingEmail}</strong>
        </p>
        <p className="login-hint">
          Click the link to activate your account. Expires in 24 hours.
        </p>
        <button className="login-primary" type="button" onClick={() => switchMode("signin")}>
          Back to sign in
        </button>
      </Shell>
    );
  }

  if (resetSent) {
    return (
      <Shell>
        <div className="login-icon-circle">📨</div>
        <h2 className="login-heading">Check your email</h2>
        <p className="login-sub">If an account exists for that email, we sent a password reset link.</p>
        <p className="login-hint">Expires in 1 hour. Check spam if you don't see it.</p>
        <button className="login-primary" type="button" onClick={() => switchMode("signin")}>
          Back to sign in
        </button>
      </Shell>
    );
  }

  if (mode === "forgot") {
    return (
      <Shell>
        <Brand title="Reset your password" subtitle="We'll email you a secure link to choose a new one." />
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={submit} className="login-form">
          <Field label="Email" htmlFor="forgot-email">
            <input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} autoComplete="email" placeholder="you@yourcompany.com" />
          </Field>
          <button type="submit" className="login-primary" disabled={loading || !email}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
        <div className="login-foot">
          <LinkBtn onClick={() => switchMode("signin")}>← Back to sign in</LinkBtn>
        </div>
      </Shell>
    );
  }

  if (mode === "signin") {
    return (
      <Shell>
        <Brand title="Welcome back" subtitle="Sign in to your Pulse workspace." />
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={submit} className="login-form">
          <Field label="Username or Email" htmlFor="login-id">
            <input id="login-id" type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoComplete="username" disabled={loading} placeholder="amal_mathew or you@company.com" />
          </Field>
          <Field label="Password" htmlFor="login-pw" hint={<LinkBtn onClick={() => switchMode("forgot")}>Forgot?</LinkBtn>}>
            <input id="login-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" disabled={loading} placeholder="••••••••" />
          </Field>
          <button type="submit" className="login-primary" disabled={loading || !identifier || !password}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {googleBlock}

        <div className="login-foot">
          <span className="login-foot-prompt">New to Pulse?</span>
          <div className="login-foot-actions">
            <button className="login-secondary" type="button" onClick={() => switchMode("create_workspace")}>
              Create workspace
            </button>
            <button className="login-secondary" type="button" onClick={() => switchMode("join_workspace")}>
              Join workspace
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const isCreate = mode === "create_workspace";
  const heading = isCreate ? "Create your workspace" : "Join your workspace";
  const subtitle = isCreate
    ? "You'll be the admin of your company's Pulse workspace."
    : "Your company already has a workspace. We'll add you to it.";
  const submitLabel = loading
    ? (isCreate ? "Creating…" : "Joining…")
    : (isCreate ? "Create workspace" : "Join workspace");
  const disabled = loading || !username || !email || !password || (isCreate && !companyName);

  return (
    <Shell>
      <Brand title={heading} subtitle={subtitle} />
      {error && <div className="login-error">{error}</div>}
      <form onSubmit={submit} className="login-form">
        {isCreate && (
          <Field label="Company Name" htmlFor="cn" hint="The display name for your workspace.">
            <input id="cn" type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required maxLength={256} disabled={loading} placeholder="Acme Corp" />
          </Field>
        )}
        <Field label="Username" htmlFor="un">
          <input id="un" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={64} autoComplete="username" disabled={loading} placeholder="Choose a username" />
        </Field>
        <Field
          label="Work Email"
          htmlFor="em"
          hint={isCreate
            ? "Your domain becomes your workspace identity."
            : "Must match your company's domain."}
        >
          <input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" disabled={loading} placeholder="you@yourcompany.com" />
        </Field>
        <Field label="Password" htmlFor="pw">
          <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" disabled={loading} placeholder="At least 8 characters" />
        </Field>
        <button type="submit" className="login-primary" disabled={disabled}>{submitLabel}</button>
      </form>

      {googleBlock}

      <div className="login-foot">
        {isCreate ? (
          <span>Already have a workspace? <LinkBtn onClick={() => switchMode("join_workspace")}>Join instead</LinkBtn></span>
        ) : (
          <span>Setting up Pulse for your company? <LinkBtn onClick={() => switchMode("create_workspace")}>Create one</LinkBtn></span>
        )}
        <div style={{ marginTop: 8 }}>
          Already have an account? <LinkBtn onClick={() => switchMode("signin")}>Sign in</LinkBtn>
        </div>
      </div>
    </Shell>
  );
}

// ---- helpers ----

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-page">
      <aside className="login-hero">
        <div className="login-hero-inner">
          <div className="login-logo">
            <span className="login-logo-dot" />
            <span className="login-logo-text">Pulse</span>
          </div>
          <h1 className="login-hero-title">
            Stop building<br />the same thing<br />twice.
          </h1>
          <p className="login-hero-sub">
            Pulse watches your Jira workspaces and remembers what your teams have already built.
          </p>
          <ul className="login-hero-list">
            <li><span>🔍</span> Detect duplicate work across teams in real time</li>
            <li><span>📋</span> Auto-generate documentation from finished tickets</li>
            <li><span>⚠️</span> Track deprecations before they break things</li>
          </ul>
          <div className="login-hero-foot">Organizational memory, powered by Claude.</div>
        </div>
      </aside>
      <main className="login-card-wrap">
        <div className="login-card">{children}</div>
      </main>
    </div>
  );
}

function Brand({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="login-brand">
      <h2 className="login-heading">{title}</h2>
      {subtitle && <p className="login-sub">{subtitle}</p>}
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="login-field">
      <div className="login-field-label-row">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <span className="login-field-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="login-link">{children}</button>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
