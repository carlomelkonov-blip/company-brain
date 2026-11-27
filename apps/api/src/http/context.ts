import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { Sql } from "../db/index.js";
import { config } from "../config.js";
import { decodeSession, SESSION_COOKIE } from "../auth/session.js";
import { findTenant, tenantSlugFromHost, dbFor, type Tenant } from "../tenancy/tenants.js";
import { loadScope, type AccessScope, type Viewer } from "../access/scope.js";

export type Env = {
  Variables: {
    tenant: Tenant;
    db: Sql;
    viewer: Viewer;
    scope: AccessScope;
  };
};

/** Resolves the customer from the subdomain and binds that customer's database to the request. */
export const tenantMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get("tenant")) return next();
  // The x-tenant header is a development convenience only; production resolves from the subdomain.
  const devOverride = config().ALLOW_DEV_LOGIN ? c.req.header("x-tenant") : undefined;
  const slug = devOverride ?? tenantSlugFromHost(c.req.header("host"));
  if (!slug) throw new HTTPException(404, { message: "Unknown workspace" });
  const tenant = await findTenant(slug);
  if (!tenant || tenant.status !== "active") throw new HTTPException(404, { message: "Unknown workspace" });
  c.set("tenant", tenant);
  c.set("db", dbFor(tenant));
  await next();
};

/** Requires a valid session for this customer; loads the viewer and their access scope. */
export const authMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get("viewer")) return next();
  const session = decodeSession(getCookie(c, SESSION_COOKIE));
  const tenant = c.get("tenant");
  if (!session || session.tenant !== tenant.slug) throw new HTTPException(401, { message: "Sign in required" });
  const [row] = await c.get("db")<{ id: string; email: string; name: string; is_admin: boolean }[]>`
    SELECT id, email, name, is_admin FROM people WHERE id = ${session.personId} AND NOT is_service_account`;
  if (!row || !emailAllowed(tenant, row.email)) throw new HTTPException(401, { message: "Sign in required" });
  const viewer: Viewer = { id: row.id, email: row.email, name: row.name, isAdmin: row.is_admin };
  c.set("viewer", viewer);
  c.set("scope", await loadScope(c.get("db"), viewer));
  await next();
};

export const adminOnly: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get("viewer").isAdmin) throw new HTTPException(403, { message: "Admins only" });
  await next();
};

/** A person may only sign into the workspace that owns their email domain. */
export function emailAllowed(tenant: Tenant, email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && tenant.emailDomains.map((d) => d.toLowerCase()).includes(domain);
}

export const ctx = (c: Context<Env>) => ({ db: c.get("db"), scope: c.get("scope"), viewer: c.get("viewer"), tenant: c.get("tenant") });
