import type { Sql } from "../db/index.js";

/**
 * Access model (PRD "Access model"):
 *  - A person is visible if it is you, someone below you in the org chart, or someone you share a project with.
 *  - A project is visible if you are a member, or someone below you in the org chart is a member.
 *  - Content (notes, transcripts, emails) is readable only if it belongs to a visible project (or no project)
 *    AND you could open it in the source tool (you are on its ACL).
 *  - The org chart and expertise are visible to everyone; expertise evidence links follow the content rule.
 *
 * The scope is computed in the database and then applied inside every content query, so the AI only
 * ever receives content the viewer may read.
 */

export interface Viewer {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface AccessScope {
  viewer: Viewer;
  /** People whose details (projects, activity) the viewer may see. Includes the viewer. */
  personIds: Set<string>;
  /** Everyone below the viewer in the org chart, at any depth. */
  subordinateIds: Set<string>;
  /** Projects the viewer may see. */
  projectIds: Set<string>;
}

export async function loadScope(sql: Sql, viewer: Viewer): Promise<AccessScope> {
  const [row] = await sql<{ subordinates: string[]; projects: string[]; people: string[] }[]>`
    WITH RECURSIVE below AS (
      SELECT id FROM people WHERE manager_id = ${viewer.id}
      UNION
      SELECT p.id FROM people p JOIN below b ON p.manager_id = b.id
    ),
    my_projects AS (
      SELECT to_id AS id FROM relationships
      WHERE type = 'member_of' AND from_kind = 'person' AND from_id = ${viewer.id} AND status = 'active'
    ),
    visible_projects AS (
      SELECT id FROM my_projects
      UNION
      SELECT r.to_id FROM relationships r
      WHERE r.type = 'member_of' AND r.from_kind = 'person' AND r.status = 'active'
        AND r.from_id IN (SELECT id FROM below)
    ),
    co_members AS (
      SELECT r.from_id AS id FROM relationships r
      WHERE r.type = 'member_of' AND r.from_kind = 'person' AND r.status = 'active'
        AND r.to_id IN (SELECT id FROM my_projects)
    )
    SELECT
      COALESCE((SELECT array_agg(id) FROM below), '{}')                                   AS subordinates,
      COALESCE((SELECT array_agg(DISTINCT id) FROM visible_projects), '{}')               AS projects,
      COALESCE((SELECT array_agg(DISTINCT id) FROM (
        SELECT ${viewer.id}::uuid AS id UNION SELECT id FROM below UNION SELECT id FROM co_members
      ) x), '{}')                                                                          AS people`;

  return {
    viewer,
    subordinateIds: new Set(row!.subordinates),
    projectIds: new Set(row!.projects),
    personIds: new Set(row!.people),
  };
}

export interface SourceAccessFields {
  acl_emails: string[];
  project_id: string | null;
}

/** The content rule, for code paths that already hold a source row. */
export function canOpenSource(scope: AccessScope, source: SourceAccessFields): boolean {
  const onAcl = source.acl_emails.some((e) => e.toLowerCase() === scope.viewer.email.toLowerCase());
  const projectOk = source.project_id === null || scope.projectIds.has(source.project_id);
  return onAcl && projectOk;
}

/** The content rule as a SQL condition over a `sources` row aliased `s`. Use in every content query. */
export function openableSourcesFilter(sql: Sql, scope: AccessScope) {
  const projectIds = [...scope.projectIds];
  return sql`(
    ${scope.viewer.email.toLowerCase()} = ANY(s.acl_emails)
    AND (s.project_id IS NULL OR s.project_id = ANY(${projectIds}::uuid[]))
  )`;
}
