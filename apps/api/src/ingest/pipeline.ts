import type { Queryable, Sql } from "../db/index.js";
import { cleanMeetingTitle, isExcludedMeetingName, mentionsProject, normalizeMeetingName } from "../graph/projects.js";
import { extract, type Attendee } from "./extract.js";
import type { Connector, DirectoryPerson, EmailMessage, MeetingArtifact } from "./types.js";

export interface SyncStats {
  people: number;
  meetings: number;
  sourcesNew: number;
  sourcesUnchanged: number;
  projects: number;
  emails: number;
  facts: number;
  meetingsWithoutContent: number;
  extractionMode: "ai" | "offline" | "mixed" | "none";
}

const lc = (e: string) => e.trim().toLowerCase();

/** Splits long text into paragraph-sized chunks for full-text search. */
export function chunkText(text: string, max = 900): string[] {
  const paras = text.split(/\n\s*\n|\r?\n(?=[-*•]|\p{Lu}[\p{L}]+:)/u).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 1 > max) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${p}` : p;
    while (cur.length > max) {
      chunks.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text.slice(0, max)];
}

export async function upsertDirectory(sql: Sql, people: DirectoryPerson[]): Promise<number> {
  await sql.begin(async (tx) => {
    for (const p of people) {
      await tx`
        INSERT INTO people (email, name, title, team, is_admin, is_service_account)
        VALUES (${lc(p.email)}, ${p.name}, ${p.title ?? null}, ${p.team ?? null}, ${p.isAdmin ?? false}, ${p.isServiceAccount ?? false})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, title = EXCLUDED.title, team = EXCLUDED.team,
          is_admin = EXCLUDED.is_admin, is_service_account = EXCLUDED.is_service_account`;
    }
    for (const p of people) {
      await tx`
        UPDATE people SET manager_id = (SELECT id FROM people WHERE email = ${p.managerEmail ? lc(p.managerEmail) : ""})
        WHERE email = ${lc(p.email)}`;
    }
  });
  return people.length;
}

async function upsertNamedEntity(sql: Queryable, type: "project" | "skill", name: string, normalized: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO entities (type, name, normalized_name) VALUES (${type}, ${name}, ${normalized})
    ON CONFLICT (type, normalized_name) WHERE type IN ('project', 'skill', 'topic') DO UPDATE SET name = entities.name
    RETURNING id`;
  return row!.id;
}

async function addRelationship(
  sql: Queryable,
  r: {
    fromKind: "person" | "entity";
    fromId: string;
    type: string;
    toKind: "person" | "entity";
    toId: string;
    sourceId?: string | null;
    validFrom: string;
    confidence?: number;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    INSERT INTO relationships (from_kind, from_id, type, to_kind, to_id, source_id, valid_from, confidence, properties)
    VALUES (${r.fromKind}, ${r.fromId}, ${r.type}, ${r.toKind}, ${r.toId}, ${r.sourceId ?? null}, ${r.validFrom},
            ${r.confidence ?? 1}, ${sql.json((r.properties ?? {}) as never)})
    ON CONFLICT DO NOTHING`;
}

interface PersonRow { id: string; email: string; name: string }

/**
 * Replaces a source if its content changed; returns null when unchanged so re-syncs are cheap and idempotent.
 * Facts derived from the old version (decisions, action items, relationships) are removed with it.
 */
async function replaceSource(
  sql: Queryable,
  s: {
    kind: string; externalId: string; title: string; occurredAt: string; projectId: string | null;
    meetingId: string | null; authorEmail: string | null; acl: string[]; url: string | null; content: string;
  },
): Promise<string | null> {
  const [existing] = await sql<{ id: string; content: string; title: string; project_id: string | null }[]>`
    SELECT id, content, title, project_id FROM sources WHERE external_id = ${s.externalId}`;
  if (existing && existing.content === s.content && existing.title === s.title && existing.project_id === s.projectId) {
    return null;
  }
  if (existing) {
    await sql`DELETE FROM entities WHERE properties->>'source_id' = ${existing.id}`;
    await sql`DELETE FROM sources WHERE id = ${existing.id}`;
  }
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO sources (kind, external_id, title, occurred_at, project_id, meeting_id, author_email, acl_emails, url, content)
    VALUES (${s.kind}, ${s.externalId}, ${s.title}, ${s.occurredAt}, ${s.projectId}, ${s.meetingId}, ${s.authorEmail},
            ${s.acl}, ${s.url}, ${s.content})
    RETURNING id`;
  const chunks = chunkText(s.content);
  for (const [i, text] of chunks.entries()) {
    await sql`INSERT INTO chunks (source_id, ord, text) VALUES (${row!.id}, ${i}, ${text})`;
  }
  return row!.id;
}

/** Teams: Facilitator notes when present, otherwise the transcript. Meet: the transcript. */
export function pickMeetingContent(m: MeetingArtifact): { kind: string; content: string } | null {
  if (m.platform === "teams") {
    if (m.facilitatorNotes?.trim()) return { kind: "facilitator_notes", content: m.facilitatorNotes };
    if (m.transcript?.trim()) return { kind: "teams_transcript", content: m.transcript };
    return null;
  }
  if (m.transcript?.trim()) return { kind: "meet_transcript", content: m.transcript };
  return null;
}

export async function ingestMeeting(
  sql: Sql,
  m: MeetingArtifact,
  people: Map<string, PersonRow>,
  excluded: Set<string>,
  stats: SyncStats,
  modes: Set<string>,
): Promise<void> {
  const attendeeEmails = [...new Set([m.organizerEmail, ...m.attendeeEmails].map(lc))];
  const attendees = attendeeEmails.map((e) => people.get(e)).filter((p): p is PersonRow => !!p);

  // Project rule: the meeting name defines the project, unless it is on the exclusion list.
  const normalized = normalizeMeetingName(m.title);
  const projectId = isExcludedMeetingName(normalized, excluded)
    ? null
    : await upsertNamedEntity(sql, "project", cleanMeetingTitle(m.title), normalized);

  const content = pickMeetingContent(m);
  if (!content) stats.meetingsWithoutContent++;

  await sql.begin(async (tx) => {
    const props = tx.json({
      external_id: m.externalId, platform: m.platform, starts_at: m.startsAt, organizer: lc(m.organizerEmail),
      has_content: !!content,
    });
    // One entity per meeting occurrence, found again by its external id on later syncs.
    let [meeting] = await tx<{ id: string }[]>`
      UPDATE entities SET name = ${m.title}, normalized_name = ${normalized}, properties = ${props}
      WHERE type = 'meeting' AND properties->>'external_id' = ${m.externalId}
      RETURNING id`;
    if (!meeting) {
      [meeting] = await tx<{ id: string }[]>`
        INSERT INTO entities (type, name, normalized_name, properties)
        VALUES ('meeting', ${m.title}, ${normalized}, ${props})
        RETURNING id`;
    }

    let sourceId: string | null = null;
    if (content) {
      sourceId = await replaceSource(tx, {
        kind: content.kind, externalId: `${m.platform}:${m.externalId}`, title: m.title, occurredAt: m.startsAt,
        projectId, meetingId: meeting!.id, authorEmail: lc(m.organizerEmail), acl: attendeeEmails,
        url: m.url ?? null, content: content.content,
      });
      if (sourceId) {
        stats.sourcesNew++;
        await tx`UPDATE sources SET meeting_id = ${meeting!.id} WHERE id = ${sourceId}`;
      } else {
        stats.sourcesUnchanged++;
        await tx`UPDATE sources SET meeting_id = ${meeting!.id} WHERE external_id = ${`${m.platform}:${m.externalId}`}`;
      }
    }

    if (projectId) {
      await addRelationship(tx, { fromKind: "entity", fromId: meeting!.id, type: "part_of", toKind: "entity", toId: projectId, validFrom: m.startsAt });
    }
    for (const p of attendees) {
      await addRelationship(tx, { fromKind: "person", fromId: p.id, type: "attended", toKind: "entity", toId: meeting!.id, validFrom: m.startsAt });
      if (projectId) {
        await addRelationship(tx, {
          fromKind: "person", fromId: p.id, type: "member_of", toKind: "entity", toId: projectId,
          validFrom: m.startsAt, properties: { via_meeting: m.externalId },
        });
      }
    }

    if (!content || !sourceId) return;

    const { result, mode } = await extract(content.content, attendees.map<Attendee>((a) => ({ email: a.email, name: a.name })));
    modes.add(mode);
    const anchor = projectId ?? meeting!.id;
    for (const d of result.decisions) {
      const [dec] = await tx<{ id: string }[]>`
        INSERT INTO entities (type, name, normalized_name, properties)
        VALUES ('decision', ${d.text}, ${d.text.toLowerCase()}, ${tx.json({ source_id: sourceId, decided_at: m.startsAt })})
        RETURNING id`;
      await addRelationship(tx, { fromKind: "entity", fromId: anchor, type: "decided", toKind: "entity", toId: dec!.id, sourceId, validFrom: m.startsAt });
      stats.facts++;
    }
    for (const a of result.actionItems) {
      const [act] = await tx<{ id: string }[]>`
        INSERT INTO entities (type, name, normalized_name, properties)
        VALUES ('action_item', ${a.text}, ${a.text.toLowerCase()}, ${tx.json({ source_id: sourceId, created_at: m.startsAt })})
        RETURNING id`;
      await addRelationship(tx, { fromKind: "entity", fromId: act!.id, type: "part_of", toKind: "entity", toId: anchor, sourceId, validFrom: m.startsAt });
      const owner = a.ownerEmail ? people.get(lc(a.ownerEmail)) : undefined;
      if (owner) {
        await addRelationship(tx, { fromKind: "entity", fromId: act!.id, type: "action_for", toKind: "person", toId: owner.id, sourceId, validFrom: m.startsAt });
      }
      stats.facts++;
    }
    for (const e of result.expertise) {
      const person = people.get(lc(e.email));
      if (!person) continue;
      const skillId = await upsertNamedEntity(tx, "skill", e.skill, e.skill.toLowerCase());
      await addRelationship(tx, {
        fromKind: "person", fromId: person.id, type: "expert_in", toKind: "entity", toId: skillId, sourceId,
        validFrom: m.startsAt, confidence: e.confidence, properties: { evidence: e.evidence, context: cleanMeetingTitle(m.title) },
      });
      stats.facts++;
    }
  });
}

export async function ingestEmail(sql: Sql, e: EmailMessage, projectsByName: Map<string, string>, stats: SyncStats): Promise<void> {
  const acl = [...new Set([e.fromEmail, ...e.toEmails, ...e.ccEmails].map(lc))];
  const haystack = normalizeMeetingName(`${e.subject}`);
  let projectId: string | null = null;
  for (const [name, id] of projectsByName) {
    if (mentionsProject(haystack, name)) { projectId = id; break; }
  }
  const content = `Subject: ${e.subject}\nFrom: ${lc(e.fromEmail)}\nTo: ${e.toEmails.map(lc).join(", ")}${e.ccEmails.length ? `\nCc: ${e.ccEmails.map(lc).join(", ")}` : ""}\n\n${e.body}`;
  const id = await replaceSource(sql, {
    kind: "email", externalId: `email:${e.externalId}`, title: e.subject, occurredAt: e.sentAt, projectId,
    meetingId: null, authorEmail: lc(e.fromEmail), acl, url: e.url ?? null, content,
  });
  if (id) stats.sourcesNew++;
  else stats.sourcesUnchanged++;
  stats.emails++;
}

/** Runs one full sync from a connector into a customer's database. */
export async function runSync(sql: Sql, connector: Connector): Promise<SyncStats> {
  const [run] = await sql<{ id: string }[]>`INSERT INTO sync_runs (connector, status) VALUES (${connector.name}, 'running') RETURNING id`;
  const stats: SyncStats = {
    people: 0, meetings: 0, sourcesNew: 0, sourcesUnchanged: 0, projects: 0, emails: 0, facts: 0,
    meetingsWithoutContent: 0, extractionMode: "none",
  };
  const modes = new Set<string>();
  try {
    stats.people = await upsertDirectory(sql, await connector.fetchDirectory());
    const people = new Map(
      (await sql<PersonRow[]>`SELECT id, email, name FROM people WHERE NOT is_service_account`).map((p) => [p.email, p]),
    );
    const excluded = new Set((await sql<{ normalized_name: string }[]>`SELECT normalized_name FROM excluded_meeting_names`).map((r) => r.normalized_name));

    const meetings = (await connector.fetchMeetings()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (const m of meetings) {
      await ingestMeeting(sql, m, people, excluded, stats, modes);
      stats.meetings++;
    }

    const projects = await sql<{ id: string; normalized_name: string }[]>`SELECT id, normalized_name FROM entities WHERE type = 'project'`;
    stats.projects = projects.length;
    const projectsByName = new Map(projects.map((p) => [p.normalized_name, p.id]));
    for (const e of await connector.fetchEmails()) await ingestEmail(sql, e, projectsByName, stats);

    stats.extractionMode = modes.size === 0 ? "none" : modes.size > 1 ? "mixed" : ([...modes][0] as "ai" | "offline");
    await sql`UPDATE sync_runs SET status = 'succeeded', stats = ${sql.json(stats as never)}, finished_at = now() WHERE id = ${run!.id}`;
    return stats;
  } catch (err) {
    await sql`UPDATE sync_runs SET status = 'failed', error = ${String(err)}, stats = ${sql.json(stats as never)}, finished_at = now() WHERE id = ${run!.id}`;
    throw err;
  }
}
