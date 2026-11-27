/** Creates the control database (if missing) and applies its migrations. Safe to run repeatedly. */
import { adminDb, closeAll, controlDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { config } from "../config.js";

export async function setupControlDatabase(): Promise<void> {
  const name = new URL(config().CONTROL_DATABASE_URL).pathname.slice(1);
  const admin = adminDb();
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const ran = await migrate(controlDb(), "control");
  console.log(ran.length ? `Control database migrated: ${ran.join(", ")}` : "Control database up to date");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setupControlDatabase()
    .then(closeAll)
    .catch(async (e) => {
      console.error(e);
      await closeAll();
      process.exit(1);
    });
}
