/**
 * Creates the demo workspace "acme" (Acme Properties, acme.test) with its own database,
 * ingests the sample company and runs the maintenance loop. Safe to run repeatedly.
 */
import { closeAll } from "../db/index.js";
import { provisionTenant, dbFor } from "../tenancy/tenants.js";
import { runSync } from "../ingest/pipeline.js";
import { runMaintenance } from "../maintenance/review.js";
import { SampleConnector } from "../connectors/sample/index.js";
import { setupControlDatabase } from "./setup.js";

async function main() {
  await setupControlDatabase();
  const tenant = await provisionTenant({ slug: "acme", name: "Acme Properties", emailDomains: ["acme.test"] });
  const db = dbFor(tenant);
  const stats = await runSync(db, new SampleConnector());
  const maintenance = await runMaintenance(db);
  console.log(`Workspace "${tenant.slug}" ready in database ${tenant.dbName}`);
  console.log("Sync:", stats);
  console.log("Maintenance:", maintenance);
}

main()
  .then(closeAll)
  .catch(async (e) => {
    console.error(e);
    await closeAll();
    process.exit(1);
  });
