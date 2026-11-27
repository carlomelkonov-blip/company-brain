import { randomBytes } from "node:crypto";
import type { Sql } from "../src/db/index.js";
import { closeAll } from "../src/db/index.js";
import { setupControlDatabase } from "../src/scripts/setup.js";
import { provisionTenant, deleteTenant, dbFor, type Tenant } from "../src/tenancy/tenants.js";
import { runSync } from "../src/ingest/pipeline.js";
import { runMaintenance } from "../src/maintenance/review.js";
import { SampleConnector } from "../src/connectors/sample/index.js";
import { loadScope, type AccessScope } from "../src/access/scope.js";

export const NOW = new Date("2026-11-28T12:00:00Z");

export interface Fixture {
  tenant: Tenant;
  db: Sql;
  person: (local: string) => Promise<{ id: string; email: string; name: string; is_admin: boolean }>;
  scopeOf: (local: string) => Promise<AccessScope>;
  teardown: () => Promise<void>;
}

/** A fresh customer database loaded with the sample company. */
export async function createFixture(): Promise<Fixture> {
  await setupControlDatabase();
  const slug = `t-${randomBytes(4).toString("hex")}`;
  const tenant = await provisionTenant({ slug, name: "Test Co", emailDomains: ["acme.test"] });
  const db = dbFor(tenant);
  await runSync(db, new SampleConnector());
  await runMaintenance(db, NOW);

  const person = async (local: string) => {
    const [p] = await db<{ id: string; email: string; name: string; is_admin: boolean }[]>`
      SELECT id, email, name, is_admin FROM people WHERE email = ${`${local}@acme.test`}`;
    if (!p) throw new Error(`no person ${local}`);
    return p;
  };
  const scopeOf = async (local: string) => {
    const p = await person(local);
    return loadScope(db, { id: p.id, email: p.email, name: p.name, isAdmin: p.is_admin });
  };
  return {
    tenant, db, person, scopeOf,
    teardown: async () => {
      await deleteTenant(slug);
      await closeAll();
    },
  };
}

export async function projectIdByName(db: Sql, name: string): Promise<string> {
  const [p] = await db<{ id: string }[]>`SELECT id FROM entities WHERE type = 'project' AND name = ${name}`;
  if (!p) throw new Error(`no project ${name}`);
  return p.id;
}
