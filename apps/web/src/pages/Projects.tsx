import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate, kindLabel } from "../api";

interface ProjectRow { id: string; name: string; members: number; last_meeting: string | null }

export function Projects() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  useEffect(() => { api<{ projects: ProjectRow[] }>("/projects").then((r) => setProjects(r.projects)); }, []);
  return (
    <div className="page">
      <h1>Projects</h1>
      <p className="muted">Each project comes from a meeting name. You see projects you're part of and those of people below you.</p>
      {!projects ? <p className="muted">Loading…</p> : projects.length === 0 ? <p className="muted">No projects you can see yet.</p> : (
        <table className="table">
          <thead><tr><th>Project</th><th>Members</th><th>Last meeting</th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                <td>{p.members}</td>
                <td>{p.last_meeting ? fmtDate(p.last_meeting) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface ProjectDetail {
  project: { id: string; name: string };
  members: { id: string; name: string; title: string | null }[];
  meetings: { id: string; title: string; starts_at: string; source_id: string | null; kind: string | null; canOpen: boolean }[];
  decisions: { id: string; text: string; status: string; date: string; source_id: string; source_title: string }[];
  actionItems: { id: string; text: string; status: string; date: string; source_id: string; source_title: string }[];
  hiddenItems: number;
}

export function ProjectPage() {
  const { id } = useParams();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<ProjectDetail>(`/projects/${id}`).then(setData).catch((e: Error) => setError(e.message)); }, [id]);
  if (error) return <div className="page error">{error}</div>;
  if (!data) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <p><Link to="/projects">← Projects</Link></p>
      <h1>{data.project.name}</h1>
      <p>Members: {data.members.map((m, i) => <span key={m.id}>{i ? ", " : ""}<Link to={`/people/${m.id}`}>{m.name}</Link></span>)}</p>

      <h2>Decisions</h2>
      {data.decisions.length ? (
        <ul className="list">
          {data.decisions.map((d) => (
            <li key={d.id} className={d.status === "retired" ? "retired" : ""}>
              {d.text} <span className="muted small">· {fmtDate(d.date)} · <Link to={`/sources/${d.source_id}`}>{d.source_title}</Link>{d.status === "retired" ? " · superseded" : ""}</span>
            </li>
          ))}
        </ul>
      ) : <p className="muted">No decisions you can see.</p>}

      <h2>Action items</h2>
      {data.actionItems.length ? (
        <ul className="list">
          {data.actionItems.map((a) => <li key={a.id}>{a.text} <span className="muted small">· {fmtDate(a.date)}</span></li>)}
        </ul>
      ) : <p className="muted">No action items you can see.</p>}

      {data.hiddenItems > 0 && (
        <p className="notice small">{data.hiddenItems} item{data.hiddenItems === 1 ? "" : "s"} come from meetings you didn't attend, so their content isn't shown to you.</p>
      )}

      <h2>Meetings</h2>
      <ul className="list">
        {data.meetings.map((m) => (
          <li key={m.id}>
            {m.canOpen && m.source_id ? <Link to={`/sources/${m.source_id}`}>{m.title}</Link> : m.title}
            <span className="muted small"> · {fmtDate(m.starts_at)}{m.kind ? ` · ${kindLabel[m.kind] ?? m.kind}` : " · no notes or transcript"}{!m.canOpen && m.source_id ? " · not shared with you" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
