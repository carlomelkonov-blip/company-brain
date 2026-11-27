import type { Sql } from "../db/index.js";

/**
 * The maintenance loop (PRD M1–M3): finds facts that look stale or conflicting and routes each to an owner
 * for a one-click confirm / correct / retire. Idempotent: re-running never duplicates open items.
 */

export const STALE_AFTER_DAYS = 180;

const STOPWORDS = new Set(
  "a an and are as at be because by for from has have in is it of on or set the to was were will with moved now new show opens approved".split(" "),
);

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Two decisions in the same project that share at least two keywords but say different things. */
export function looksConflicting(a: string, b: string): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return false;
  const ka = keywords(a);
  let shared = 0;
  for (const w of keywords(b)) if (ka.has(w)) shared++;
  return shared >= 2;
}

interface DecisionRow {
  rel_id: string;
  decision_id: string;
  text: string;
  project_id: string;
  project_name: string;
  source_id: string;
  source_title: string;
  decided_at: string;
}

async function projectOwner(sql: Sql, projectId: string): Promise<string | null> {
  // The organizer of the project's most recent meeting is its knowledge owner.
  const [row] = await sql<{ id: string }[]>`
    SELECT p.id FROM entities m
    JOIN relationships r ON r.from_id = m.id AND r.type = 'part_of' AND r.to_id = ${projectId}
    JOIN people p ON p.email = m.properties->>'organizer'
    WHERE m.type = 'meeting'
    ORDER BY m.properties->>'starts_at' DESC LIMIT 1`;
  return row?.id ?? null;
}

export async function runMaintenance(sql: Sql, now: Date = new Date()): Promise<{ conflicts: number; stale: number }> {
  let conflicts = 0;
  let stale = 0;

  const decisions = await sql<DecisionRow[]>`
    SELECT r.id AS rel_id, d.id AS decision_id, d.name AS text, pr.id AS project_id, pr.name AS project_name,
           s.id AS source_id, s.title AS source_title, s.occurred_at::text AS decided_at
    FROM relationships r
    JOIN entities d ON d.id = r.to_id AND d.type = 'decision'
    JOIN entities pr ON pr.id = r.from_id AND pr.type = 'project'
    JOIN sources s ON s.id = r.source_id
    WHERE r.type = 'decided' AND r.status = 'active'
    ORDER BY s.occurred_at`;

  const byProject = new Map<string, DecisionRow[]>();
  for (const dRow of decisions) byProject.set(dRow.project_id, [...(byProject.get(dRow.project_id) ?? []), dRow]);

  for (const [projectId, rows] of byProject) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const older = rows[i]!;
        const newer = rows[j]!;
        if (older.source_id === newer.source_id || !looksConflicting(older.text, newer.text)) continue;
        const owner = await projectOwner(sql, projectId);
        const inserted = await sql`
          INSERT INTO review_items (kind, title, detail, relationship_ids, project_id, assignee_id, dedupe_key)
          VALUES ('conflict', ${`Possible conflict in ${older.project_name}`},
                  ${sql.json({
                    older: { text: older.text, date: older.decided_at, source: older.source_title, decision_id: older.decision_id },
                    newer: { text: newer.text, date: newer.decided_at, source: newer.source_title, decision_id: newer.decision_id },
                  })},
                  ${[older.rel_id, newer.rel_id]}, ${projectId}, ${owner}, ${`conflict:${older.decision_id}:${newer.decision_id}`})
          ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`;
        conflicts += inserted.length;
      }
    }
  }

  // Expertise whose newest evidence is older than STALE_AFTER_DAYS: ask the person to confirm it.
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString();
  const staleRows = await sql<{ person_id: string; person_name: string; skill_id: string; skill: string; rel_ids: string[]; newest: string }[]>`
    SELECT p.id AS person_id, p.name AS person_name, sk.id AS skill_id, sk.name AS skill,
           array_agg(r.id) AS rel_ids, max(r.valid_from)::text AS newest
    FROM relationships r
    JOIN people p ON p.id = r.from_id
    JOIN entities sk ON sk.id = r.to_id AND sk.type = 'skill'
    WHERE r.type = 'expert_in' AND r.status = 'active'
    GROUP BY p.id, p.name, sk.id, sk.name
    HAVING max(r.valid_from) < ${cutoff}`;
  for (const s of staleRows) {
    const inserted = await sql`
      INSERT INTO review_items (kind, title, detail, relationship_ids, assignee_id, dedupe_key)
      VALUES ('stale', ${`Is ${s.person_name} still an expert in ${s.skill}?`},
              ${sql.json({ person: s.person_name, skill: s.skill, newest_evidence: s.newest })},
              ${s.rel_ids}, ${s.person_id}, ${`stale:${s.person_id}:${s.skill_id}:${s.newest.slice(0, 10)}`})
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`;
    stale += inserted.length;
  }

  return { conflicts, stale };
}

export type ReviewAction = "confirm" | "correct" | "retire";

/**
 * confirm: the newer fact stands (conflict: the older one is retired; stale: evidence refreshed today).
 * correct: like confirm, but the surviving fact's text is replaced with the reviewer's correction.
 * retire:  every fact on the item is retired.
 */
export async function resolveReviewItem(
  sql: Sql,
  input: { itemId: string; action: ReviewAction; resolverId: string; correctedText?: string; note?: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const [item] = await tx<{ id: string; kind: string; status: string; relationship_ids: string[]; detail: Record<string, any> }[]>`
      SELECT id, kind, status, relationship_ids, detail FROM review_items WHERE id = ${input.itemId} FOR UPDATE`;
    if (!item) throw new Error("Review item not found");
    if (item.status !== "open") throw new Error("Review item is already resolved");

    const rels = item.relationship_ids;
    if (input.action === "retire") {
      await tx`UPDATE relationships SET status = 'retired', valid_to = now() WHERE id = ANY(${rels}::uuid[])`;
    } else if (item.kind === "conflict") {
      const [olderRel] = rels;
      await tx`UPDATE relationships SET status = 'retired', valid_to = now() WHERE id = ${olderRel!}`;
      if (input.action === "correct" && input.correctedText) {
        await tx`UPDATE entities SET name = ${input.correctedText}, normalized_name = ${input.correctedText.toLowerCase()}
                 WHERE id = ${item.detail.newer?.decision_id ?? null}`;
      }
    } else if (item.kind === "stale") {
      await tx`UPDATE relationships SET valid_from = now(),
                 properties = properties || ${tx.json({ confirmed_by_owner: true, note: input.note ?? null })}
               WHERE id = ANY(${rels}::uuid[])`;
    }
    const status = input.action === "confirm" ? "confirmed" : input.action === "correct" ? "corrected" : "retired";
    await tx`UPDATE review_items SET status = ${status}, resolved_at = now(), resolved_by = ${input.resolverId},
               resolution_note = ${input.note ?? input.correctedText ?? null} WHERE id = ${item.id}`;
  });
}
