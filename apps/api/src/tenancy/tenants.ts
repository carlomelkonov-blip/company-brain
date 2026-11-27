import { adminDb, closeTenantPool, controlDb, tenantDb, type Sql } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { config } from "../config.js";

export interface Tenant {
  slug: string;
  name: string;
  dbName: string;
  emailDomains: string[];
  connectedSuites: string[];
  status: "active" | "suspended";
}

interface TenantRow {
  slug: string;
  name: string;
  db_name: string;
  email_domains: string[];
  connected_suites: string[];
  status: "active" | "suspended";
}

const toTenant = (r: TenantRow): Tenant => ({
  slug: r.slug,
  name: r.name,
  dbName: r.db_name,
  emailDomains: r.email_domains,
  connectedSuites: r.connected_suites,
  status: r.status,
});

const cache = new Map<string, { tenant: Tenant | null; at: number }>();
const CACHE_MS = 30_000;

export async function findTenant(slug: string): Promise<Tenant | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;
  const rows = await controlDb()<TenantRow[]>`SELECT * FROM tenants WHERE slug = ${slug}`;
  const tenant = rows[0] ? toTenant(rows[0]) : null;
  cache.set(slug, { tenant, at: Date.now() });
  return tenant;
}

/**
 * The customer comes from the subdomain: acme.companybrain.com and acme.localhost both mean "acme".
 * A bare host (localhost, an IP) falls back to DEFAULT_TENANT, which should be empty in production.
 */
export function tenantSlugFromHost(hostHeader: string | undefined): string | null {
  const host = (hostHeader ?? "").split(":")[0]!.toLowerCase();
  const labels = host.split(".").filter(Boolean);
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (!isIp) {
    if (labels.length >= 2 && labels.at(-1) === "localhost") return labels[0]!;
    if (labels.length >= 3) return labels[0]!;
  }
  return config().DEFAULT_TENANT || null;
}

export function dbNameForSlug(slug: string): string {
  return `cb_tenant_${slug.replace(/-/g, "_")}`;
}

/** Creates the customer's own database, runs its migrations and registers it in the control database. */
export async function provisionTenant(input: { slug: string; name: string; emailDomains: string[] }): Promise<Tenant> {
  const dbName = dbNameForSlug(input.slug);
  const admin = adminDb();
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  await migrate(tenantDb(dbName), "tenant");
  const rows = await controlDb()<TenantRow[]>`
    INSERT INTO tenants (slug, name, db_name, email_domains)
    VALUES (${input.slug}, ${input.name}, ${dbName}, ${input.emailDomains})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, email_domains = EXCLUDED.email_domains
    RETURNING *`;
  cache.delete(input.slug);
  return toTenant(rows[0]!);
}

/** Deletes a customer entirely: their database and their control row (GDPR offboarding). */
export async function deleteTenant(slug: string): Promise<void> {
  const tenant = await findTenant(slug);
  if (!tenant) return;
  await closeTenantPool(tenant.dbName);
  const admin = adminDb();
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${tenant.dbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
  await controlDb()`DELETE FROM tenants WHERE slug = ${slug}`;
  cache.delete(slug);
}

export function dbFor(tenant: Tenant): Sql {
  return tenantDb(tenant.dbName);
}
