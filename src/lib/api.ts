// Typed API client for workflow persistence

export type WorkflowSummary = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { executions: number };
};

export type WorkflowDetail = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  tileGraph: { nodes: unknown[]; edges: unknown[] };
  version: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionSummary = {
  startedAt: string;
  id: string;
  status: string;
  workflowId: string;
  createdAt: string;
  updatedAt: string;
  _count?: { artifacts: number };
};

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  workflows: {
    list: () =>
      apiFetch<{ workflows: WorkflowSummary[] }>("/api/workflows"),

    get: (id: string) =>
      apiFetch<{ workflow: WorkflowDetail }>(`/api/workflows/${id}`),

    create: (data: { name?: string; description?: string; tags?: string[]; tileGraph?: unknown }) =>
      apiFetch<{ workflow: WorkflowDetail }>("/api/workflows", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    update: (id: string, data: Partial<{ name: string; description: string; tags: string[]; tileGraph: unknown }>) =>
      apiFetch<{ workflow: WorkflowDetail }>(`/api/workflows/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/workflows/${id}`, { method: "DELETE" }),
  },

  executions: {
    list: (options?: { limit?: number; status?: string }) => {
      const params = new URLSearchParams();
      if (options?.limit) params.set("limit", String(options.limit));
      if (options?.status) params.set("status", options.status);
      const query = params.toString();
      return apiFetch<{ executions: ExecutionSummary[] }>(
        `/api/executions${query ? `?${query}` : ""}`
      );
    },

    create: (workflowId: string) =>
      apiFetch<{ execution: { id: string } }>("/api/executions", {
        method: "POST",
        body: JSON.stringify({ workflowId }),
      }),

    update: (id: string, data: { status: string; tileResults?: unknown[]; errorMessage?: string }) =>
      apiFetch<{ execution: { id: string } }>(`/api/executions/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },
};
