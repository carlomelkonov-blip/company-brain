import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));

export type MigrationSet = "control" | "tenant";

function migrationsDir(set: MigrationSet): string {
  // Works from src/ (tsx) and from dist/ (compiled), because the build copies SQL next to it.
  return join(here, "migrations", set);
}

/** Applies every .sql file not yet recorded in schema_migrations, in name order, each in a transaction. */
export async function migrate(sql: Sql, set: MigrationSet): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
  const files = (await readdir(migrationsDir(set))).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(join(migrationsDir(set), file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations(name) VALUES (${file})`;
    });
    ran.push(file);
  }
  return ran;
}
