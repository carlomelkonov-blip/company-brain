import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate, kindLabel, type AskResult } from "../api";

interface Turn { question: string; result?: AskResult; error?: string; flagged?: boolean }

const EXAMPLES = [
  "What is the Riverside Towers launch date?",
  "Who knows Jira?",
  "What did we decide about the new CRM?",
  "Who does Petar report to?",
];

/** Turns "[2]" markers in an answer into links to that citation's source. */
function withCitationLinks(text: string, result: AskResult): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    const c = m ? result.citations.find((x) => x.n === Number(m[1])) : undefined;
    return c ? <Link key={i} className="cite" to={`/sources/${c.sourceId}`} title={c.title}>{part}</Link> : <span key={i}>{part}</span>;
  });
}

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setQuestion("");
    setTurns((t) => [...t, { question: text }]);
    try {
      const result = await api<AskResult>("/ask", { body: { question: text } });
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, result } : turn)));
    } catch (e) {
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, error: (e as Error).message } : turn)));
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const flag = async (index: number) => {
    const turn = turns[index];
    if (!turn?.result) return;
    const reason = window.prompt("What's wrong with this answer? (optional)") ?? undefined;
    await api("/ask/flag", {
      body: { question: turn.question, answer: turn.result.answer, reason, sourceIds: turn.result.citations.map((c) => c.sourceId) },
    });
    setTurns((t) => t.map((x, i) => (i === index ? { ...x, flagged: true } : x)));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(question);
  };

  return (
    <div className="chat">
      <div className="chat-log">
        {turns.length === 0 && (
          <div className="chat-empty">
            <h1>Ask your company</h1>
            <p className="muted">Answers come only from meetings, emails and documents you're allowed to see, with a source for every claim.</p>
            <div className="examples">
              {EXAMPLES.map((ex) => <button key={ex} onClick={() => send(ex)}>{ex}</button>)}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="turn">
            <div className="q">{turn.question}</div>
            {!turn.result && !turn.error && <div className="a muted">Thinking…</div>}
            {turn.error && <div className="a error">{turn.error}</div>}
            {turn.result && (
              <div className="a">
                <div className="answer">{withCitationLinks(turn.result.answer, turn.result)}</div>
                {turn.result.experts && turn.result.experts.length > 0 && (
                  <div className="experts">
                    {turn.result.experts.map((e) => (
                      <div key={`${e.personId}-${e.skill}`} className="expert">
                        <Link to={`/people/${e.personId}`} className="name">{e.name}</Link>
                        <span className="muted small"> {e.title} · {e.skill} · {e.evidenceCount} evidence</span>
                        <ul>
                          {e.evidence.map((ev, j) => (
                            <li key={j} className="small">
                              “{ev.summary}” <span className="muted">({ev.context ?? "record"}, {ev.date})</span>
                              {ev.citation ? <> {withCitationLinks(`[${ev.citation}]`, turn.result!)}</> : <span className="muted"> · source not shared with you</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                {turn.result.citations.length > 0 && (
                  <ol className="sources">
                    {turn.result.citations.map((c) => (
                      <li key={c.n}>
                        <Link to={`/sources/${c.sourceId}`}>[{c.n}] {c.title}</Link>
                        <span className="muted small"> · {kindLabel[c.kind] ?? c.kind} · {fmtDate(c.occurredAt)}{c.projectName ? ` · ${c.projectName}` : ""}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="answer-foot">
                  <span className="pill small">{turn.result.mode === "ai" ? "AI answer" : "Offline answer"}</span>
                  {turn.flagged ? (
                    <span className="muted small">Flagged for review. Thanks.</span>
                  ) : (
                    <button className="link small" onClick={() => flag(i)}>Flag as wrong</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about a project, a decision, or who knows what…"
          aria-label="Your question"
          autoFocus
        />
        <button type="submit" disabled={busy || question.trim().length < 2}>Ask</button>
      </form>
    </div>
  );
}
