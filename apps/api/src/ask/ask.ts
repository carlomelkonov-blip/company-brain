import type { Sql } from "../db/index.js";
import { canOpenSource, openableSourcesFilter, type AccessScope } from "../access/scope.js";
import { aiConfigured, complete } from "../ai/provider.js";
import { SKILLS } from "../ingest/skills.js";

export type Intent = "expertise" | "org" | "search";

export interface Citation {
  n: number;
  sourceId: string;
  title: string;
  kind: string;
  occurredAt: string;
  projectName: string | null;
  url: string | null;
}

export interface ExpertResult {
  personId: string;
  name: string;
  title: string | null;
  skill: string;
  evidenceCount: number;
  evidence: { summary: string; context: string | null; date: string; citation: number | null }[];
}

export interface AskResult {
  intent: Intent;
  mode: "ai" | "offline";
  answer: string;
  citations: Citation[];
  experts?: ExpertResult[];
}

const EXPERTISE_RE = /\b(who\s+(knows|is\s+good\s+at|has\s+experience|can\s+help|is\s+an?\s+expert)|expert(s|ise)?\s+(in|on|with)|experience\s+(with|in))\b/i;
const ORG_RE = /\b(reports?\s+to|manager\s+of|who\s+manages|who\s+is\s+the\s+manager|direct\s+reports|org\s*chart)\b/i;

export function detectIntent(question: string): Intent {
  if (EXPERTISE_RE.test(question)) return "expertise";
  if (ORG_RE.test(question)) return "org";
  return "search";
}

const STOP = new Set(
  "a about after all also an and any are as at be been but by can could did do does for from get had has have how i if in into is it its me my of on or our please say says should so tell than that the their them then there these they this to us was we were what when where which who whom why will with would you your know knows expert experts expertise experience someone anyone good".split(" "),
);

export function searchTerms(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .normalize("NFKC")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 1 && !STOP.has(w)),
    ),
  ].slice(0, 12);
}

/** Skill names a question asks about: known aliases first, then any skill entity named in it. */
async function skillsAskedAbout(sql: Sql, question: string): Promise<{ id: string; name: string }[]> {
  const q = question.toLowerCase();
  const known = SKILLS.filter((s) => s.aliases.some((a) => new RegExp(`(?<![\\p{L}])${a}(?![\\p{L}])`, "iu").test(q))).map((s) => s.name.toLowerCase());
  const terms = searchTerms(question);
  return sql<{ id: string; name: string }[]>`
    SELECT id, name FROM entities
    WHERE type = 'skill' AND (normalized_name = ANY(${known}) OR normalized_name = ANY(${terms}))`;
}

async function answerExpertise(sql: Sql, scope: AccessScope, question: string): Promise<AskResult> {
  const skills = await skillsAskedAbout(sql, question);
  if (skills.length === 0) {
    return {
      intent: "expertise", mode: "offline", citations: [], experts: [],
      answer: "I couldn't match that to a skill in the company graph yet. Try naming the tool or area, for example \"Who knows Jira?\".",
    };
  }
  // Expertise is visible company-wide (PRD). Evidence links follow the content rule.
  const rows = await sql<{
    person_id: string; name: string; title: string | null; skill: string; confidence: number;
    evidence: string | null; context: string | null; valid_from: string;
    source_id: string | null; s_title: string | null; s_kind: string | null; s_url: string | null;
    acl_emails: string[] | null; project_id: string | null; project_name: string | null;
  }[]>`
    SELECT p.id AS person_id, p.name, p.title, sk.name AS skill, r.confidence,
           r.properties->>'evidence' AS evidence, r.properties->>'context' AS context, r.valid_from::text,
           s.id AS source_id, s.title AS s_title, s.kind AS s_kind, s.url AS s_url, s.acl_emails, s.project_id,
           pr.name AS project_name
    FROM relationships r
    JOIN people p ON p.id = r.from_id AND NOT p.is_service_account
    JOIN entities sk ON sk.id = r.to_id
    LEFT JOIN sources s ON s.id = r.source_id
    LEFT JOIN entities pr ON pr.id = s.project_id
    WHERE r.type = 'expert_in' AND r.status = 'active' AND sk.id = ANY(${skills.map((s) => s.id)}::uuid[])
    ORDER BY r.valid_from DESC`;

  const citations: Citation[] = [];
  const citeIndex = new Map<string, number>();
  const experts = new Map<string, ExpertResult & { score: number }>();
  for (const r of rows) {
    let citation: number | null = null;
    if (r.source_id && r.acl_emails && canOpenSource(scope, { acl_emails: r.acl_emails, project_id: r.project_id })) {
      citation = citeIndex.get(r.source_id) ?? null;
      if (citation === null) {
        citation = citations.length + 1;
        citeIndex.set(r.source_id, citation);
        citations.push({
          n: citation, sourceId: r.source_id, title: r.s_title!, kind: r.s_kind!, occurredAt: r.valid_from,
          projectName: r.project_name, url: r.s_url,
        });
      }
    }
    const key = `${r.person_id}|${r.skill}`;
    const e = experts.get(key) ?? { personId: r.person_id, name: r.name, title: r.title, skill: r.skill, evidenceCount: 0, evidence: [], score: 0 };
    e.evidenceCount++;
    e.score += r.confidence;
    if (e.evidence.length < 3) {
      e.evidence.push({ summary: r.evidence ?? "Mentioned in company records", context: r.context, date: r.valid_from.slice(0, 10), citation });
    }
    experts.set(key, e);
  }
  const ranked = [...experts.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  const skillNames = [...new Set(skills.map((s) => s.name))].join(", ");
  const answer = ranked.length
    ? [
        `People with evidence of ${skillNames} expertise:`,
        ...ranked.map((e, i) => {
          const ev = e.evidence[0]!;
          const cite = ev.citation ? ` [${ev.citation}]` : "";
          return `${i + 1}. ${e.name}${e.title ? ` (${e.title})` : ""}: ${e.evidenceCount} piece${e.evidenceCount === 1 ? "" : "s"} of evidence, e.g. "${ev.summary}"${cite}`;
        }),
      ].join("\n")
    : `Nobody has evidence of ${skillNames} expertise in the company graph yet.`;
  return { intent: "expertise", mode: "offline", answer, citations, experts: ranked.map(({ score: _s, ...e }) => e) };
}

async function answerOrg(sql: Sql, question: string): Promise<AskResult> {
  // The org chart is visible to everyone.
  const people = await sql<{ id: string; name: string; title: string | null; manager_name: string | null; manager_id: string | null }[]>`
    SELECT p.id, p.name, p.title, m.name AS manager_name, p.manager_id
    FROM people p LEFT JOIN people m ON m.id = p.manager_id WHERE NOT p.is_service_account`;
  const q = question.toLowerCase();
  const named = people.find((p) => q.includes(p.name.toLowerCase()) || q.includes(p.name.split(" ")[0]!.toLowerCase()));
  if (!named) {
    return { intent: "org", mode: "offline", citations: [], answer: "Name the person you're asking about, for example \"Who does Petar report to?\". The full org chart is on the People page." };
  }
  const reports = people.filter((p) => p.manager_id === named.id);
  const lines = [
    `${named.name}${named.title ? `, ${named.title},` : ""} ${named.manager_name ? `reports to ${named.manager_name}` : "is at the top of the org chart"}.`,
    reports.length ? `Direct reports: ${reports.map((r) => r.name).join(", ")}.` : "No direct reports.",
  ];
  return { intent: "org", mode: "offline", citations: [], answer: lines.join(" ") };
}

interface Hit {
  source_id: string; title: string; kind: string; occurred_at: string; url: string | null;
  project_name: string | null; text: string; rank: number;
}

async function answerSearch(sql: Sql, scope: AccessScope, question: string): Promise<AskResult> {
  const terms = searchTerms(question).map((t) => t.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (terms.length === 0) {
    return { intent: "search", mode: "offline", citations: [], answer: "Could you add a few more words about what you're looking for?" };
  }
  const tsquery = terms.map((t) => `${t}:*`).join(" | ");
  // Access rules are applied inside the query: only content the viewer may read is ever retrieved.
  const hits = await sql<Hit[]>`
    SELECT s.id AS source_id, s.title, s.kind, s.occurred_at::text, s.url, pr.name AS project_name, c.text,
           ts_rank(c.tsv, to_tsquery('english', ${tsquery})) AS rank
    FROM chunks c
    JOIN sources s ON s.id = c.source_id
    LEFT JOIN entities pr ON pr.id = s.project_id
    WHERE c.tsv @@ to_tsquery('english', ${tsquery}) AND ${openableSourcesFilter(sql, scope)}
    ORDER BY rank DESC, s.occurred_at DESC
    LIMIT 8`;

  if (hits.length === 0) {
    return {
      intent: "search", mode: "offline", citations: [],
      answer: "I couldn't find anything about that in the meetings, emails and documents you have access to.",
    };
  }

  const citations: Citation[] = [];
  const bySource = new Map<string, number>();
  const context: string[] = [];
  for (const h of hits) {
    let n = bySource.get(h.source_id);
    if (!n) {
      n = citations.length + 1;
      bySource.set(h.source_id, n);
      citations.push({
        n, sourceId: h.source_id, title: h.title, kind: h.kind, occurredAt: h.occurred_at,
        projectName: h.project_name, url: h.url,
      });
    }
    context.push(`[${n}] ${h.title} (${h.kind.replace("_", " ")}, ${h.occurred_at.slice(0, 10)}):\n${h.text}`);
  }

  if (aiConfigured()) {
    try {
      const answer = await complete({
        system: `You are Company Brain, answering employees' questions about their company.
Answer ONLY from the numbered sources. Cite every claim with its source number in square brackets, like [2].
If sources disagree, prefer the most recent and say that it changed. If the sources do not answer the question,
say you are not sure and what is missing. Be concise: at most 6 sentences or a short list.`,
        user: `Question: ${question}\n\nSources:\n${context.join("\n\n")}`,
        maxTokens: 700,
      });
      return { intent: "search", mode: "ai", answer, citations };
    } catch {
      // fall through to the offline answer
    }
  }

  // Offline: the most relevant sources, shown newest first so later decisions are read before earlier ones.
  const seen = new Set<string>();
  const top: Hit[] = [];
  for (const h of hits) {
    if (seen.has(h.source_id) || top.length >= 4) continue;
    seen.add(h.source_id);
    top.push(h);
  }
  top.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const bullets = top.map((h) => `- ${h.occurred_at.slice(0, 10)}: ${bestLines(h.text, terms)} [${bySource.get(h.source_id)}]`);
  return {
    intent: "search",
    mode: "offline",
    citations,
    answer: `Here's what I found in sources you can open (newest first):\n${bullets.join("\n")}`,
  };
}

/** Picks the lines of a chunk that mention the most query terms. */
function bestLines(text: string, terms: string[]): string {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const score = (l: string) => terms.filter((t) => l.toLowerCase().includes(t)).length;
  const sorted = [...lines].sort((a, b) => score(b) - score(a));
  const top = sorted.slice(0, 2).filter((l) => score(l) > 0);
  const out = (top.length ? top : sorted.slice(0, 1)).join(" … ").replace(/^[-*•]\s*/, "");
  return out.length > 280 ? `${out.slice(0, 279)}…` : out;
}

export async function ask(sql: Sql, scope: AccessScope, question: string): Promise<AskResult> {
  const intent = detectIntent(question);
  const result =
    intent === "expertise" ? await answerExpertise(sql, scope, question)
    : intent === "org" ? await answerOrg(sql, question)
    : await answerSearch(sql, scope, question);
  await sql`INSERT INTO question_log (person_id, question, intent, mode, n_sources)
            VALUES (${scope.viewer.id}, ${question}, ${result.intent}, ${result.mode}, ${result.citations.length})`;
  return result;
}
