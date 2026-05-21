export type Feature = {
  id: number;
  name: string;
  summary: string;
  team: string;
  product_group: string;
  status: string;
  deprecation_reason?: string | null;
  ticket_key?: string | null;
  dependencies: string[];
  changelog?: string | null;
  restored_at?: string | null;
  restored_reason?: string | null;
  created_at: string;
  updated_at: string;
};

export type FeatureSearchHit = { feature: Feature; score: number };

export type Alert = {
  id: number;
  type:
    | "duplicate"
    | "deprecation"
    | "dependency"
    | "info"
    | "cross_product_consideration"
    | "pending_deprecation";
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
  ticket_key?: string | null;
  related_feature_id?: number | null;
  related_features: Array<{ ticket_key: string; similarity_score?: number }>;
  approval_state?: "pending" | "resolved" | "rejected" | null;
  action_log: Array<{ at: string; action: string; details?: Record<string, unknown> }>;
  created_at: string;
  read_at?: string | null;
};

export type RelatedFeature = {
  feature: Feature;
  similarity_score: number | null;
  open_in_jira_url: string | null;
};

export type Project = {
  key: string;
  name: string;
  description: string;
  product_group: string;
  is_inferred: boolean;
  jira_account_id: number | null;
  jira_account_label: string | null;
  created_at: string;
  updated_at: string;
};

export type JiraAccount = {
  id: number;
  label: string;
  base_url: string;
  email: string;
  is_active: boolean;
  is_default: boolean;
  has_token: boolean;
  has_webhook_secret: boolean;
  created_at: string;
  updated_at: string;
};

export type JiraAccountCreate = {
  label: string;
  base_url: string;
  email: string;
  api_token: string;
  webhook_secret?: string;
  is_active?: boolean;
  is_default?: boolean;
};

export type JiraAccountUpdate = {
  label?: string;
  base_url?: string;
  email?: string;
  api_token?: string;       // blank/undefined = keep existing
  webhook_secret?: string;
  is_active?: boolean;
  is_default?: boolean;
};

export type JiraAccountTestResult = {
  ok: boolean;
  status_code: number | null;
  message: string;
  user_displayname?: string | null;
  user_email?: string | null;
};

export type AgentRun = {
  id: number;
  agent: string;
  ticket_key?: string | null;
  input_summary: string;
  output_summary: string;
  tool_calls: Array<{ tool: string; input: unknown; result: unknown; is_error: boolean }>;
  started_at: string;
  finished_at?: string | null;
};

// In production (Vercel), set VITE_API_BASE_URL to your backend URL (e.g. ngrok).
// In dev, leave it empty — Vite's proxy handles /api, /auth, /jira-webhook.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

const TOKEN_KEY = "pulse_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init?.headers) {
    Object.entries(init.headers as Record<string, string>).forEach(([k, v]) => { headers[k] = v; });
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // ngrok free tier shows a browser warning page; this header skips it for API calls.
  if (API_BASE) headers["ngrok-skip-browser-warning"] = "true";
  const res = await fetch(API_BASE + path, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
};

export const auth = {
  login: async (username: string, password: string): Promise<{ access_token: string; token_type: string }> => {
    const body = new URLSearchParams({ username, password });
    const loginHeaders: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (API_BASE) loginHeaders["ngrok-skip-browser-warning"] = "true";
    const res = await fetch(API_BASE + "/auth/login", {
      method: "POST",
      headers: loginHeaders,
      body: body.toString(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Login failed" }));
      throw new Error(err.detail || `${res.status}`);
    }
    return res.json();
  },

  me: () => http<AuthUser>("/auth/me"),

  verifyEmail: async (token: string): Promise<{ access_token: string; token_type: string }> => {
    const headers: Record<string, string> = {};
    if (API_BASE) headers["ngrok-skip-browser-warning"] = "true";
    const res = await fetch(`${API_BASE}/auth/verify?token=${encodeURIComponent(token)}`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Verification failed" }));
      throw new Error(err.detail || `${res.status}`);
    }
    return res.json();
  },

  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_BASE) headers["ngrok-skip-browser-warning"] = "true";
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Request failed" }));
      throw new Error(err.detail || `${res.status}`);
    }
    return res.json();
  },

  googleLogin: async (accessToken: string): Promise<{ access_token: string; token_type: string }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_BASE) headers["ngrok-skip-browser-warning"] = "true";
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers,
      body: JSON.stringify({ access_token: accessToken }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Google sign-in failed" }));
      throw new Error(err.detail || `${res.status}`);
    }
    return res.json();
  },

  resetPassword: async (
    token: string,
    new_password: string,
  ): Promise<{ access_token: string; token_type: string }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_BASE) headers["ngrok-skip-browser-warning"] = "true";
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token, new_password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Reset failed" }));
      throw new Error(err.detail || `${res.status}`);
    }
    return res.json();
  },

  signup: async (
    username: string,
    email: string,
    password: string,
    mode: "create" | "join",
    company_name?: string,
  ): Promise<{ message: string; email: string }> => {
    const signupHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (API_BASE) signupHeaders["ngrok-skip-browser-warning"] = "true";
    const res = await fetch(API_BASE + "/auth/signup", {
      method: "POST",
      headers: signupHeaders,
      body: JSON.stringify({ username, email, password, mode, company_name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Signup failed" }));
      throw new Error(err.detail || `${res.status}`);
    }
    return res.json();
  },
};

export const api = {
  search: (query: string, top_k = 5, filters?: Record<string, string>) =>
    http<FeatureSearchHit[]>("/api/search", {
      method: "POST",
      body: JSON.stringify({ query, top_k, filters }),
    }),

  ask: (message: string) =>
    http<{ response: string; tool_calls: AgentRun["tool_calls"] }>("/api/ask", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  features: (status?: string) =>
    http<Feature[]>(`/api/features${status ? `?status=${encodeURIComponent(status)}` : ""}`),

  changelog: () => http<Feature[]>("/api/changelog"),

  alerts: () => http<Alert[]>("/api/alerts"),

  markAlertRead: (id: number) =>
    http<Alert>(`/api/alerts/${id}/read`, { method: "POST" }),

  alertRelatedFeatures: (id: number) =>
    http<RelatedFeature[]>(`/api/alerts/${id}/related-features`),

  deleteAlert: (id: number) =>
    http<void>(`/api/alerts/${id}`, { method: "DELETE" }),

  clearReadAlerts: () =>
    http<{ deleted_count: number }>("/api/alerts?status=read", { method: "DELETE" }),

  approveAlert: (id: number, feature_ticket_keys: string[] | null) =>
    http<Alert>(`/api/alerts/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ feature_ticket_keys }),
    }),

  rejectAlert: (id: number, reason?: string) =>
    http<Alert>(`/api/alerts/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? null }),
    }),

  restoreFeature: (id: number, reason?: string) =>
    http<Feature>(`/api/features/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? null }),
    }),

  agentRuns: (limit = 20) => http<AgentRun[]>(`/api/agent-runs?limit=${limit}`),

  projects: () => http<Project[]>("/api/projects"),

  setProductGroup: (key: string, product_group: string) =>
    http<Project>(`/api/projects/${encodeURIComponent(key)}/product-group`, {
      method: "POST",
      body: JSON.stringify({ product_group }),
    }),

  syncProjects: () =>
    http<{
      synced: number;
      new_projects: string[];
      deleted_projects: string[];
      error?: string;
    }>("/api/projects/sync", { method: "POST" }),

  jiraAccounts: {
    list: () => http<JiraAccount[]>("/api/jira-accounts"),

    create: (body: JiraAccountCreate) =>
      http<JiraAccount>("/api/jira-accounts", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    update: (id: number, body: JiraAccountUpdate) =>
      http<JiraAccount>(`/api/jira-accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),

    delete: (id: number) =>
      http<void>(`/api/jira-accounts/${id}`, { method: "DELETE" }),

    test: (id: number) =>
      http<JiraAccountTestResult>(`/api/jira-accounts/${id}/test`, {
        method: "POST",
      }),
  },
};
