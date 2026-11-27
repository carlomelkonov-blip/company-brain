import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app.js";
import { provisionTenant, deleteTenant } from "../src/tenancy/tenants.js";
import { createFixture, projectIdByName, type Fixture } from "./helpers.js";

let f: Fixture;
const app = buildApp();
const otherSlug = `o-${Date.now().toString(36)}`;

beforeAll(async () => {
  f = await createFixture();
  // A second customer with a different email domain.
  await provisionTenant({ slug: otherSlug, name: "Other Co", emailDomains: ["other.test"] });
});
afterAll(async () => {
  await deleteTenant(otherSlug);
  await f.teardown();
});

const host = (slug: string) => ({ host: `${slug}.companybrain.com` });

async function login(slug: string, email: string): Promise<{ status: number; cookie: string }> {
  const res = await app.request("/api/auth/dev-login", {
    method: "POST",
    headers: { ...host(slug), "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return { status: res.status, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]! };
}

describe("workspaces and sign-in", () => {
  it("resolves the workspace from the subdomain", async () => {
    const res = await app.request("/api/workspace", { headers: host(f.tenant.slug) });
    expect(await res.json()).toMatchObject({ slug: f.tenant.slug });
  });

  it("returns 404 for an unknown workspace", async () => {
    const res = await app.request("/api/workspace", { headers: host("nope-nope") });
    expect(res.status).toBe(404);
  });

  it("refuses sign-in to a workspace that does not own the email domain", async () => {
    expect((await login(otherSlug, "nikolay@acme.test")).status).toBe(403);
  });

  it("a session for one workspace is rejected by another", async () => {
    const { cookie } = await login(f.tenant.slug, "nikolay@acme.test");
    const ok = await app.request("/api/me", { headers: { ...host(f.tenant.slug), cookie } });
    expect(ok.status).toBe(200);
    const cross = await app.request("/api/me", { headers: { ...host(otherSlug), cookie } });
    expect(cross.status).toBe(401);
  });

  it("requires sign-in for content", async () => {
    const res = await app.request("/api/projects", { headers: host(f.tenant.slug) });
    expect(res.status).toBe(401);
  });
});

describe("content endpoints apply the access rules", () => {
  it("hides projects outside the viewer's scope", async () => {
    const { cookie } = await login(f.tenant.slug, "nikolay@acme.test");
    const board = await projectIdByName(f.db, "Board Prep Q4");
    const res = await app.request(`/api/projects/${board}`, { headers: { ...host(f.tenant.slug), cookie } });
    expect(res.status).toBe(404);
  });

  it("a manager sees a report's project but not content from meetings they did not attend", async () => {
    const { cookie } = await login(f.tenant.slug, "maria@acme.test");
    const web = await projectIdByName(f.db, "Website Redesign");
    const res = await app.request(`/api/projects/${web}`, { headers: { ...host(f.tenant.slug), cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decisions: unknown[]; hiddenItems: number; meetings: { canOpen: boolean }[] };
    expect(body.decisions).toHaveLength(0);
    expect(body.hiddenItems).toBeGreaterThan(0);
    expect(body.meetings.every((m) => !m.canOpen)).toBe(true);
  });

  it("admin endpoints are for admins only", async () => {
    const { cookie } = await login(f.tenant.slug, "nikolay@acme.test");
    const res = await app.request("/api/admin/status", { headers: { ...host(f.tenant.slug), cookie } });
    expect(res.status).toBe(403);
    const admin = await login(f.tenant.slug, "georgi@acme.test");
    const ok = await app.request("/api/admin/status", { headers: { ...host(f.tenant.slug), cookie: admin.cookie } });
    expect(ok.status).toBe(200);
  });
});
