import { useCallback, useEffect, useState } from "react";
import { api, fmtDate, type Me } from "../api";

interface Item {
  id: string; kind: "stale" | "conflict" | "flagged_answer"; title: string; created_at: string;
  project_name: string | null; assignee_name: string | null; detail: Record<string, any>;
}

const KIND_LABEL = { stale: "Possibly outdated", conflict: "Conflicting facts", flagged_answer: "Flagged answer" };

export function Review({ me }: { me: Me }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ items: Item[] }>("/review").then((r) => setItems(r.items)).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const resolve = async (item: Item, action: "confirm" | "correct" | "retire") => {
    let correctedText: string | undefined;
    if (action === "correct") {
      correctedText = window.prompt("Correct text:", item.detail.newer?.text ?? "") ?? undefined;
      if (!correctedText) return;
    }
    try {
      await api(`/review/${item.id}/resolve`, { body: { action, correctedText } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <h1>Review</h1>
      <p className="muted">
        Facts that look outdated or conflicting, and answers people flagged. One click keeps the brain accurate.
        {me.isAdmin ? " As an admin you see everyone's items." : ""}
      </p>
      {error && <p className="error">{error}</p>}
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted">Nothing to review. 🎉</p> : (
        <div className="cards">
          {items.map((it) => (
            <div key={it.id} className="card">
              <div className="card-head">
                <span className={`pill pill-${it.kind}`}>{KIND_LABEL[it.kind]}</span>
                <span className="muted small">{fmtDate(it.created_at)}{it.project_name ? ` · ${it.project_name}` : ""}{me.isAdmin && it.assignee_name ? ` · for ${it.assignee_name}` : ""}</span>
              </div>
              <h3>{it.title}</h3>
              {it.kind === "conflict" && (
                <div className="compare">
                  <div><div className="muted small">Earlier · {fmtDate(it.detail.older.date)}</div>{it.detail.older.text}</div>
                  <div><div className="muted small">Later · {fmtDate(it.detail.newer.date)}</div>{it.detail.newer.text}</div>
                </div>
              )}
              {it.kind === "stale" && (
                <p className="small">Newest evidence is from {fmtDate(it.detail.newest_evidence)}. Is this still true?</p>
              )}
              {it.kind === "flagged_answer" && (
                <div className="small">
                  <p><strong>Question:</strong> {it.detail.question}</p>
                  <p><strong>Answer:</strong> {it.detail.answer}</p>
                  {it.detail.reason && <p><strong>Reason:</strong> {it.detail.reason}</p>}
                </div>
              )}
              <div className="actions">
                <button onClick={() => resolve(it, "confirm")}>{it.kind === "conflict" ? "Keep the later one" : "Confirm"}</button>
                {it.kind === "conflict" && <button className="secondary" onClick={() => resolve(it, "correct")}>Correct…</button>}
                <button className="secondary" onClick={() => resolve(it, "retire")}>{it.kind === "flagged_answer" ? "Dismiss" : "Retire"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
