import { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "../api";

interface Status {
  workspace: { slug: string; name: string; emailDomains: string[] };
  ai: "configured" | "offline";
  connectors: { name: string; status: string }[];
  counts: Record<string, number>;
  runs: { id: string; connector: string; status: string; stats: Record<string, unknown>; error: string | null; started_at: string }[];
  exclusions: string[];
}

export function Admin() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [newExclusion, setNewExclusion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Status>("/admin/status").then(setStatus).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setBusy(true);
    try { await api("/admin/sync", { method: "POST" }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const addExclusion = async () => {
    if (!newExclusion.trim()) return;
    await api("/admin/exclusions", { body: { name: newExclusion } });
    setNewExclusion("");
    await load();
  };
  const removeExclusion = async (name: string) => {
    await api(`/admin/exclusions/${encodeURIComponent(name)}`, { method: "DELETE" });
    await load();
  };

  if (!status) return <div className="page muted">{error ?? "Loading…"}</div>;
  return (
    <div className="page">
      <h1>Admin</h1>
      <p className="muted">{status.workspace.name} · {status.workspace.slug} · domains: {status.workspace.emailDomains.join(", ")} · AI: {status.ai}</p>
      {error && <p className="error">{error}</p>}

      <div className="stats">
        {Object.entries(status.counts).map(([k, v]) => (
          <div key={k} className="stat"><div className="stat-n">{v}</div><div className="muted small">{k.replace(/_/g, " ")}</div></div>
        ))}
      </div>

      <h2>Connectors</h2>
      <table className="table">
        <thead><tr><th>Connector</th><th>Status</th></tr></thead>
        <tbody>{status.connectors.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.status}</td></tr>)}</tbody>
      </table>
      <p><button onClick={sync} disabled={busy}>{busy ? "Syncing…" : "Run sample sync"}</button></p>

      <h2>Recent syncs</h2>
      <table className="table">
        <thead><tr><th>Started</th><th>Connector</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>
          {status.runs.map((r) => (
            <tr key={r.id}>
              <td>{fmtDate(r.started_at)}</td><td>{r.connector}</td><td>{r.status}</td>
              <td className="small">{r.error ?? `${r.stats.meetings ?? 0} meetings, ${r.stats.sourcesNew ?? 0} new sources, ${r.stats.facts ?? 0} facts, extraction: ${r.stats.extractionMode ?? "—"}`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Meeting names that never become projects</h2>
      <div className="chips">
        {status.exclusions.map((e) => (
          <span key={e} className="chip">{e} <button className="link" aria-label={`Remove ${e}`} onClick={() => removeExclusion(e)}>×</button></span>
        ))}
      </div>
      <p className="inline-form">
        <input value={newExclusion} onChange={(e) => setNewExclusion(e.target.value)} placeholder="e.g. Coffee chat" />
        <button className="secondary" onClick={addExclusion}>Add</button>
      </p>
    </div>
  );
}
