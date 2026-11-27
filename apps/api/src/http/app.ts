import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { config } from "../config.js";
import { encodeSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "../auth/session.js";
import { ask } from "../ask/ask.js";
import { canOpenSource } from "../access/scope.js";
import { runSync } from "../ingest/pipeline.js";
import { SampleConnector } from "../connectors/sample/index.js";
import { normalizeMeetingName } from "../graph/projects.js";
import { resolveReviewItem, runMaintenance } from "../maintenance/review.js";
import { aiConfigured } from "../ai/provider.js";
import { adminOnly, authMiddleware, ctx, emailAllowed, tenantMiddleware, type Env } from "./context.js";

const body = async <T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
  return parsed.data;
};

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

export function buildApp() {
  const app = new Hono<Env>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // ---- Public, per workspace ----
  const pub = new Hono<Env>();
  pub.use("*", tenantMiddleware);

  pub.get("/workspace", (c) => {
    const t = c.get("tenant");
    return c.json({ slug: t.slug, name: t.name, devLogin: config().ALLOW_DEV_LOGIN, ai: aiConfigured() });
  });

  // Dev-only sign-in: choose a person from the directory. Production uses "Sign in with Microsoft/Google".
  pub.get("/auth/dev-people", async (c) => {
    if (!config().ALLOW_DEV_LOGIN) throw new HTTPException(404, { message: "Not found" });
    const people = await c.get("db")`
      SELECT id, name, title, email FROM people WHERE NOT is_service_account ORDER BY name`;
    return c.json({ people });
  });

  pub.post("/auth/dev-login", async (c) => {
    if (!config().ALLOW_DEV_LOGIN) throw new HTTPException(404, { message: "Not found" });
    const { email } = await body(c, z.object({ email: z.string().email() }));
    const tenant = c.get("tenant");
    if (!emailAllowed(tenant, email)) throw new HTTPException(403, { message: "This account does not belong to this workspace" });
    const [person] = await c.get("db")<{ id: string }[]>`
      SELECT id FROM people WHERE email = ${email.toLowerCase()} AND NOT is_service_account`;
    if (!person) throw new HTTPException(403, { message: "Not in this company's directory" });
    setCookie(c, SESSION_COOKIE, encodeSession({ tenant: tenant.slug, personId: person.id }), {
      httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_TTL_SECONDS, secure: false,
    });
    return c.json({ ok: true });
  });

  pub.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ---- Signed in ----
  const authed = new Hono<Env>();
  authed.use("*", tenantMiddleware, authMiddleware);

  authed.get("/me", (c) => {
    const { viewer, scope } = ctx(c);
    return c.json({ ...viewer, visibleProjects: scope.projectIds.size, visiblePeople: scope.personIds.size });
  });

  authed.post("/ask", async (c) => {
    const { question } = await body(c, z.object({ question: z.string().trim().min(2).max(1000) }));
    const { db, scope } = ctx(c);
    return c.json(await ask(db, scope, question));
  });

  // M2: a user flags a wrong answer; it lands in the review queue of the cited project's owner, else an admin.
  authed.post("/ask/flag", async (c) => {
    const input = await body(c, z.object({
      question: z.string().max(1000), answer: z.string().max(8000), reason: z.string().max(1000).optional(),
      sourceIds: z.array(z.string().uuid()).max(20).default([]),
    }));
    const { db, viewer } = ctx(c);
    const [assignee] = await db<{ id: string; project_id: string | null }[]>`
      SELECT p.id, s.project_id FROM sources s
      JOIN entities m ON m.id = s.meeting_id
      JOIN people p ON p.email = m.properties->>'organizer'
      WHERE s.id = ANY(${input.sourceIds}::uuid[])
      UNION ALL
      SELECT id, NULL FROM people WHERE is_admin
      LIMIT 1`;
    await db`
      INSERT INTO review_items (kind, title, detail, assignee_id, project_id)
      VALUES ('flagged_answer', ${`Answer flagged by ${viewer.name}`},
              ${db.json({ question: input.question, answer: input.answer, reason: input.reason ?? null, flagged_by: viewer.name, source_ids: input.sourceIds })},
              ${assignee?.id ?? null}, ${assignee?.project_id ?? null})`;
    return c.json({ ok: true });
  });

  // The org chart and everyone's expertise are visible to all employees.
  authed.get("/org", async (c) => {
    const { db } = ctx(c);
    const people = await db`
      SELECT p.id, p.name, p.title, p.team, p.manager_id,
        COALESCE((
          SELECT json_agg(json_build_object('skill', x.name, 'evidence', x.n) ORDER BY x.n DESC)
          FROM (
            SELECT sk.name, count(*)::int AS n FROM relationships r JOIN entities sk ON sk.id = r.to_id
            WHERE r.from_id = p.id AND r.type = 'expert_in' AND r.status = 'active'
            GROUP BY sk.name
          ) x
        ), '[]') AS skills
      FROM people p WHERE NOT p.is_service_account ORDER BY p.name`;
    return c.json({ people });
  });

  authed.get("/people/:id", async (c) => {
    const { db, scope } = ctx(c);
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new HTTPException(404, { message: "Not found" });
    const [person] = await db`
      SELECT p.id, p.name, p.title, p.team, p.email, m.id AS manager_id, m.name AS manager_name
      FROM people p LEFT JOIN people m ON m.id = p.manager_id
      WHERE p.id = ${id.data} AND NOT p.is_service_account`;
    if (!person) throw new HTTPException(404, { message: "Not found" });
    const reports = await db`SELECT id, name, title FROM people WHERE manager_id = ${id.data} ORDER BY name`;
    const skills = await db`
      SELECT sk.name AS skill, count(*)::int AS evidence, max(r.valid_from)::text AS latest
      FROM relationships r JOIN entities sk ON sk.id = r.to_id
      WHERE r.from_id = ${id.data} AND r.type = 'expert_in' AND r.status = 'active'
      GROUP BY sk.name ORDER BY evidence DESC`;
    const canSeeDetails = scope.personIds.has(id.data);
    const projects = canSeeDetails
      ? await db`
          SELECT DISTINCT e.id, e.name FROM relationships r JOIN entities e ON e.id = r.to_id
          WHERE r.from_id = ${id.data} AND r.type = 'member_of' AND r.status = 'active'
            AND e.id = ANY(${[...scope.projectIds]}::uuid[])
          ORDER BY e.name`
      : [];
    return c.json({ person, reports, skills, canSeeDetails, projects });
  });

  authed.get("/projects", async (c) => {
    const { db, scope } = ctx(c);
    const projects = await db`
      SELECT e.id, e.name,
        (SELECT count(DISTINCT r.from_id)::int FROM relationships r WHERE r.to_id = e.id AND r.type = 'member_of' AND r.status = 'active') AS members,
        (SELECT max(m.properties->>'starts_at') FROM relationships r JOIN entities m ON m.id = r.from_id
          WHERE r.to_id = e.id AND r.type = 'part_of' AND m.type = 'meeting') AS last_meeting
      FROM entities e
      WHERE e.type = 'project' AND e.id = ANY(${[...scope.projectIds]}::uuid[])
      ORDER BY last_meeting DESC NULLS LAST`;
    return c.json({ projects });
  });

  authed.get("/projects/:id", async (c) => {
    const { db, scope } = ctx(c);
    const id = c.req.param("id");
    if (!isUuid(id) || !scope.projectIds.has(id)) throw new HTTPException(404, { message: "Not found or no access" });
    const [project] = await db`SELECT id, name FROM entities WHERE id = ${id} AND type = 'project'`;
    const members = await db`
      SELECT DISTINCT p.id, p.name, p.title FROM relationships r JOIN people p ON p.id = r.from_id
      WHERE r.to_id = ${id} AND r.type = 'member_of' AND r.status = 'active' ORDER BY p.name`;
    const meetings = await db<{ id: string; title: string; starts_at: string; source_id: string | null; kind: string | null; acl_emails: string[] | null; project_id: string | null }[]>`
      SELECT m.id, m.name AS title, m.properties->>'starts_at' AS starts_at, s.id AS source_id, s.kind, s.acl_emails, s.project_id
      FROM relationships r JOIN entities m ON m.id = r.from_id AND m.type = 'meeting'
      LEFT JOIN sources s ON s.meeting_id = m.id
      WHERE r.to_id = ${id} AND r.type = 'part_of'
      ORDER BY starts_at DESC`;
    const facts = await db<{ id: string; type: string; text: string; status: string; date: string; source_id: string; acl_emails: string[]; project_id: string | null; source_title: string }[]>`
      SELECT d.id, d.type, d.name AS text, r.status, s.occurred_at::text AS date, s.id AS source_id, s.acl_emails, s.project_id, s.title AS source_title
      FROM relationships r
      JOIN entities d ON d.id = CASE WHEN r.type = 'decided' THEN r.to_id ELSE r.from_id END
      JOIN sources s ON s.id = r.source_id
      WHERE ((r.type = 'decided' AND r.from_id = ${id}) OR (r.type = 'part_of' AND r.to_id = ${id} AND d.type = 'action_item'))
      ORDER BY s.occurred_at DESC`;
    // Project content follows the content rule: only items from sources the viewer can open.
    const visibleFacts = facts
      .filter((f) => canOpenSource(scope, f))
      .map(({ acl_emails: _a, project_id: _p, ...f }) => f);
    return c.json({
      project, members,
      meetings: meetings.map(({ acl_emails, project_id, ...m }) => ({
        ...m, canOpen: !!m.source_id && canOpenSource(scope, { acl_emails: acl_emails ?? [], project_id }),
      })),
      decisions: visibleFacts.filter((f) => f.type === "decision"),
      actionItems: visibleFacts.filter((f) => f.type === "action_item"),
      hiddenItems: facts.length - visibleFacts.length,
    });
  });

  authed.get("/sources/:id", async (c) => {
    const { db, scope } = ctx(c);
    if (!isUuid(c.req.param("id"))) throw new HTTPException(404, { message: "Not found or no access" });
    const [s] = await db<{ id: string; title: string; kind: string; occurred_at: string; url: string | null; content: string; acl_emails: string[]; project_id: string | null; project_name: string | null }[]>`
      SELECT s.id, s.title, s.kind, s.occurred_at::text, s.url, s.content, s.acl_emails, s.project_id, pr.name AS project_name
      FROM sources s LEFT JOIN entities pr ON pr.id = s.project_id WHERE s.id = ${c.req.param("id")}`;
    if (!s || !canOpenSource(scope, s)) throw new HTTPException(404, { message: "Not found or no access" });
    const { acl_emails: _a, ...rest } = s;
    return c.json({ source: rest });
  });

  authed.get("/review", async (c) => {
    const { db, viewer } = ctx(c);
    const items = await db`
      SELECT ri.id, ri.kind, ri.status, ri.title, ri.detail, ri.created_at, pr.name AS project_name, a.name AS assignee_name
      FROM review_items ri
      LEFT JOIN entities pr ON pr.id = ri.project_id
      LEFT JOIN people a ON a.id = ri.assignee_id
      WHERE ri.status = 'open' AND (ri.assignee_id = ${viewer.id} OR ${viewer.isAdmin})
      ORDER BY ri.created_at DESC`;
    return c.json({ items });
  });

  authed.post("/review/:id/resolve", async (c) => {
    const { db, viewer } = ctx(c);
    const input = await body(c, z.object({
      action: z.enum(["confirm", "correct", "retire"]),
      correctedText: z.string().trim().min(2).max(500).optional(),
      note: z.string().max(1000).optional(),
    }));
    if (!isUuid(c.req.param("id"))) throw new HTTPException(404, { message: "Not found" });
    if (input.action === "correct" && !input.correctedText) throw new HTTPException(400, { message: "correctedText is required" });
    const [item] = await db<{ assignee_id: string | null }[]>`SELECT assignee_id FROM review_items WHERE id = ${c.req.param("id")}`;
    if (!item) throw new HTTPException(404, { message: "Not found" });
    if (item.assignee_id !== viewer.id && !viewer.isAdmin) throw new HTTPException(403, { message: "Only the assignee or an admin can resolve this" });
    await resolveReviewItem(db, { itemId: c.req.param("id"), resolverId: viewer.id, ...input });
    return c.json({ ok: true });
  });

  // ---- Admin ----
  const admin = new Hono<Env>();
  admin.use("*", tenantMiddleware, authMiddleware, adminOnly);

  admin.get("/status", async (c) => {
    const { db, tenant } = ctx(c);
    const runs = await db`SELECT id, connector, status, stats, error, started_at, finished_at FROM sync_runs ORDER BY started_at DESC LIMIT 10`;
    const [counts] = await db`
      SELECT (SELECT count(*)::int FROM people WHERE NOT is_service_account) AS people,
             (SELECT count(*)::int FROM entities WHERE type = 'project') AS projects,
             (SELECT count(*)::int FROM sources) AS sources,
             (SELECT count(*)::int FROM relationships WHERE status = 'active') AS facts,
             (SELECT count(*)::int FROM review_items WHERE status = 'open') AS open_reviews,
             (SELECT count(*)::int FROM entities WHERE type = 'meeting' AND (properties->>'has_content')::boolean IS NOT TRUE) AS meetings_without_content`;
    const exclusions = await db`SELECT normalized_name FROM excluded_meeting_names ORDER BY normalized_name`;
    return c.json({
      workspace: { slug: tenant.slug, name: tenant.name, emailDomains: tenant.emailDomains },
      ai: aiConfigured() ? "configured" : "offline",
      connectors: [
        { name: "sample", status: "available" },
        { name: "microsoft365", status: "not yet implemented" },
        { name: "google-workspace", status: "not yet implemented" },
      ],
      counts, runs, exclusions: exclusions.map((e) => e.normalized_name),
    });
  });

  admin.post("/sync", async (c) => {
    const { db } = ctx(c);
    const stats = await runSync(db, new SampleConnector());
    const maintenance = await runMaintenance(db);
    return c.json({ stats, maintenance });
  });

  admin.post("/exclusions", async (c) => {
    const { name } = await body(c, z.object({ name: z.string().trim().min(1).max(200) }));
    const normalized = normalizeMeetingName(name);
    await ctx(c).db`INSERT INTO excluded_meeting_names (normalized_name) VALUES (${normalized}) ON CONFLICT DO NOTHING`;
    return c.json({ ok: true, normalized });
  });

  admin.delete("/exclusions/:name", async (c) => {
    await ctx(c).db`DELETE FROM excluded_meeting_names WHERE normalized_name = ${decodeURIComponent(c.req.param("name"))}`;
    return c.json({ ok: true });
  });

  app.route("/", pub);
  app.route("/", authed);
  app.route("/admin", admin);
  return app;
}
