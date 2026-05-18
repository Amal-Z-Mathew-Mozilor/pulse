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
  created_at: string;
  updated_at: string;
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

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  // 204 No Content has an empty body; don't try to parse JSON.
  if (res.status === 204) return undefined as T;
  return res.json();
}

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
};
