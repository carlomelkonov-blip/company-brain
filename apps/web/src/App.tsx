import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, ApiError, type Me, type Workspace } from "./api";
import { Login } from "./pages/Login";
import { Chat } from "./pages/Chat";
import { People, PersonPage } from "./pages/People";
import { Projects, ProjectPage } from "./pages/Projects";
import { Review } from "./pages/Review";
import { Admin } from "./pages/Admin";
import { SourcePage } from "./pages/Source";

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>("/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api<Workspace>("/workspace")
      .then((w) => {
        setWorkspace(w);
        document.title = `${w.name} · Company Brain`;
        return loadMe();
      })
      .catch((e: Error) => setError(e.message));
  }, [loadMe]);

  if (error) {
    return (
      <div className="center-page">
        <h1>Company Brain</h1>
        <p className="muted">{error}. Open your workspace address, for example <code>acme.localhost:5173</code>.</p>
      </div>
    );
  }
  if (!workspace || me === undefined) return <div className="center-page muted">Loading…</div>;
  if (me === null) return <Login workspace={workspace} onSignedIn={loadMe} />;

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setMe(null);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◆</span>
          <div>
            <div className="brand-name">Company Brain</div>
            <div className="brand-ws">{workspace.name}</div>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>Ask</NavLink>
          <NavLink to="/people">People</NavLink>
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/review">Review</NavLink>
          {me.isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="sidebar-foot">
          <div className="me-name">{me.name}</div>
          <div className="muted small">{me.email}</div>
          {!workspace.ai && <div className="pill pill-warn small" title="No AI key configured: simpler answers">Offline mode</div>}
          <button className="link" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/people" element={<People />} />
          <Route path="/people/:id" element={<PersonPage />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/sources/:id" element={<SourcePage />} />
          <Route path="/review" element={<Review me={me} />} />
          <Route path="/admin" element={me.isAdmin ? <Admin /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
