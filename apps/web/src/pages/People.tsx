import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type OrgPerson } from "../api";

function OrgNode({ person, byManager }: { person: OrgPerson; byManager: Map<string | null, OrgPerson[]> }) {
  const reports = byManager.get(person.id) ?? [];
  return (
    <li>
      <div className="org-card">
        <Link to={`/people/${person.id}`} className="name">{person.name}</Link>
        <div className="muted small">{person.title}{person.team ? ` · ${person.team}` : ""}</div>
        {person.skills.length > 0 && (
          <div className="chips">{person.skills.slice(0, 4).map((s) => <span key={s.skill} className="chip">{s.skill}</span>)}</div>
        )}
      </div>
      {reports.length > 0 && (
        <ul>{reports.map((r) => <OrgNode key={r.id} person={r} byManager={byManager} />)}</ul>
      )}
    </li>
  );
}

export function People() {
  const [people, setPeople] = useState<OrgPerson[]>([]);
  const [filter, setFilter] = useState("");
  useEffect(() => { api<{ people: OrgPerson[] }>("/org").then((r) => setPeople(r.people)); }, []);

  const byManager = useMemo(() => {
    const m = new Map<string | null, OrgPerson[]>();
    for (const p of people) m.set(p.manager_id, [...(m.get(p.manager_id) ?? []), p]);
    return m;
  }, [people]);

  const q = filter.trim().toLowerCase();
  const matches = q
    ? people.filter((p) => p.name.toLowerCase().includes(q) || p.skills.some((s) => s.skill.toLowerCase().includes(q)))
    : [];

  return (
    <div className="page">
      <h1>People</h1>
      <p className="muted">The org chart and everyone's expertise are visible to the whole company.</p>
      <input className="search" placeholder="Find a person or a skill…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {q ? (
        <ul className="list">
          {matches.map((p) => (
            <li key={p.id}>
              <Link to={`/people/${p.id}`}>{p.name}</Link> <span className="muted small">{p.title}</span>
              <div className="chips">{p.skills.map((s) => <span key={s.skill} className="chip">{s.skill}</span>)}</div>
            </li>
          ))}
          {matches.length === 0 && <li className="muted">No matches.</li>}
        </ul>
      ) : (
        <ul className="org-tree">{(byManager.get(null) ?? []).map((p) => <OrgNode key={p.id} person={p} byManager={byManager} />)}</ul>
      )}
    </div>
  );
}

interface PersonDetail {
  person: { id: string; name: string; title: string | null; team: string | null; email: string; manager_id: string | null; manager_name: string | null };
  reports: { id: string; name: string; title: string | null }[];
  skills: { skill: string; evidence: number; latest: string }[];
  canSeeDetails: boolean;
  projects: { id: string; name: string }[];
}

export function PersonPage() {
  const { id } = useParams();
  const [data, setData] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    api<PersonDetail>(`/people/${id}`).then(setData).catch((e: Error) => setError(e.message));
  }, [id]);
  if (error) return <div className="page error">{error}</div>;
  if (!data) return <div className="page muted">Loading…</div>;
  const { person } = data;
  return (
    <div className="page">
      <p><Link to="/people">← People</Link></p>
      <h1>{person.name}</h1>
      <p className="muted">{person.title}{person.team ? ` · ${person.team}` : ""} · {person.email}</p>
      <p>
        {person.manager_id ? <>Reports to <Link to={`/people/${person.manager_id}`}>{person.manager_name}</Link></> : "Top of the org chart"}
        {data.reports.length > 0 && <> · Direct reports: {data.reports.map((r, i) => <span key={r.id}>{i ? ", " : ""}<Link to={`/people/${r.id}`}>{r.name}</Link></span>)}</>}
      </p>
      <h2>Expertise</h2>
      {data.skills.length ? (
        <div className="chips">{data.skills.map((s) => <span key={s.skill} className="chip">{s.skill} · {s.evidence}</span>)}</div>
      ) : <p className="muted">No expertise recorded yet.</p>}
      <h2>Projects</h2>
      {!data.canSeeDetails ? (
        <p className="muted">Project details are only visible for yourself, people below you in the org chart, and people you share a project with.</p>
      ) : data.projects.length ? (
        <ul className="list">{data.projects.map((p) => <li key={p.id}><Link to={`/projects/${p.id}`}>{p.name}</Link></li>)}</ul>
      ) : <p className="muted">No projects you can see.</p>}
    </div>
  );
}
