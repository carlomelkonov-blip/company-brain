export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Workspace { slug: string; name: string; devLogin: boolean; ai: boolean }
export interface Me { id: string; email: string; name: string; isAdmin: boolean; visibleProjects: number; visiblePeople: number }

export interface Citation {
  n: number; sourceId: string; title: string; kind: string; occurredAt: string; projectName: string | null; url: string | null;
}
export interface Expert {
  personId: string; name: string; title: string | null; skill: string; evidenceCount: number;
  evidence: { summary: string; context: string | null; date: string; citation: number | null }[];
}
export interface AskResult {
  intent: "expertise" | "org" | "search"; mode: "ai" | "offline"; answer: string; citations: Citation[]; experts?: Expert[];
}

export interface OrgPerson {
  id: string; name: string; title: string | null; team: string | null; manager_id: string | null;
  skills: { skill: string; evidence: number }[];
}

export const kindLabel: Record<string, string> = {
  facilitator_notes: "Facilitator notes",
  teams_transcript: "Teams transcript",
  meet_transcript: "Meet transcript",
  email: "Email",
  document: "Document",
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
