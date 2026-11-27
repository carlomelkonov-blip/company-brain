import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate, kindLabel } from "../api";

interface SourceDetail {
  source: { id: string; title: string; kind: string; occurred_at: string; url: string | null; content: string; project_id: string | null; project_name: string | null };
}

export function SourcePage() {
  const { id } = useParams();
  const [data, setData] = useState<SourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<SourceDetail>(`/sources/${id}`).then(setData).catch((e: Error) => setError(e.message)); }, [id]);
  if (error) return <div className="page error">{error}</div>;
  if (!data) return <div className="page muted">Loading…</div>;
  const s = data.source;
  return (
    <div className="page">
      <p className="muted small">{kindLabel[s.kind] ?? s.kind} · {fmtDate(s.occurred_at)}{s.project_id ? <> · <Link to={`/projects/${s.project_id}`}>{s.project_name}</Link></> : null}</p>
      <h1>{s.title}</h1>
      {s.url && <p><a href={s.url} target="_blank" rel="noreferrer">Open in the original tool</a></p>}
      <pre className="source-body">{s.content}</pre>
    </div>
  );
}
