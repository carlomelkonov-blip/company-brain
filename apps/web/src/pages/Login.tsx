import { useEffect, useState } from "react";
import { api, type Workspace } from "../api";

interface DevPerson { id: string; name: string; title: string | null; email: string }

export function Login({ workspace, onSignedIn }: { workspace: Workspace; onSignedIn: () => void }) {
  const [people, setPeople] = useState<DevPerson[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspace.devLogin) api<{ people: DevPerson[] }>("/auth/dev-people").then((r) => setPeople(r.people)).catch((e: Error) => setError(e.message));
  }, [workspace.devLogin]);

  const signIn = async (email: string) => {
    setError(null);
    try {
      await api("/auth/dev-login", { body: { email } });
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="center-page">
      <div className="login-card">
        <div className="brand brand-lg"><span className="brand-mark" aria-hidden>◆</span> Company Brain</div>
        <h1>{workspace.name}</h1>
        <div className="sso">
          <button disabled title="Coming next: requires app registration with Microsoft">Sign in with Microsoft</button>
          <button disabled title="Coming next: requires app registration with Google">Sign in with Google</button>
        </div>
        {workspace.devLogin && (
          <>
            <p className="muted small">Development sign-in: choose a person from the directory to see the brain through their eyes.</p>
            <ul className="dev-people">
              {people.map((p) => (
                <li key={p.id}>
                  <button onClick={() => signIn(p.email)}>
                    <span className="name">{p.name}</span>
                    <span className="muted small">{p.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
