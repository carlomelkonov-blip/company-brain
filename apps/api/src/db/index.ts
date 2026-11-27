import postgres from "postgres";
import { config } from "../config.js";

export type Sql = postgres.Sql;
/** A pool or an open transaction: anything that can run a query. */
export type Queryable = postgres.Sql | postgres.TransactionSql;

let control: Sql | undefined;
const tenantPools = new Map<string, Sql>();

const baseOptions = { max: 5, idle_timeout: 30, onnotice: () => {} } as const;

export function controlDb(): Sql {
  if (!control) control = postgres(config().CONTROL_DATABASE_URL, baseOptions);
  return control;
}

export function tenantDatabaseUrl(dbName: string): string {
  return config().TENANT_DATABASE_URL_TEMPLATE.replace("{db}", dbName);
}

/** One connection pool per customer database, created on first use. */
export function tenantDb(dbName: string): Sql {
  let pool = tenantPools.get(dbName);
  if (!pool) {
    pool = postgres(tenantDatabaseUrl(dbName), baseOptions);
    tenantPools.set(dbName, pool);
  }
  return pool;
}

export async function closeTenantPool(dbName: string): Promise<void> {
  const pool = tenantPools.get(dbName);
  tenantPools.delete(dbName);
  await pool?.end();
}

/** A connection to the server's maintenance database, used to create databases. */
export function adminDb(): Sql {
  const url = new URL(config().CONTROL_DATABASE_URL);
  url.pathname = "/postgres";
  return postgres(url.toString(), { ...baseOptions, max: 1 });
}

export async function closeAll(): Promise<void> {
  await Promise.all([control?.end(), ...[...tenantPools.values()].map((p) => p.end())]);
  control = undefined;
  tenantPools.clear();
}
