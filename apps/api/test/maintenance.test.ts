import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveReviewItem, runMaintenance, looksConflicting } from "../src/maintenance/review.js";
import { runSync } from "../src/ingest/pipeline.js";
import { SampleConnector } from "../src/connectors/sample/index.js";
import { createFixture, NOW, type Fixture } from "./helpers.js";

let f: Fixture;
beforeAll(async () => { f = await createFixture(); });
afterAll(async () => { await f.teardown(); });

describe("conflict detection", () => {
  it("flags decisions on the same topic that say different things", () => {
    expect(looksConflicting("Launch date set to 15 March 2027.", "Launch date moved to 29 March 2027 because of permit delays.")).toBe(true);
    expect(looksConflicting("Price list v3 approved for the first 40 apartments.", "Show apartment opens on 1 March.")).toBe(false);
  });
});

describe("maintenance loop", () => {
  it("finds the launch-date conflict and assigns it to the project's organizer", async () => {
    const [item] = await f.db<{ title: string; assignee_id: string }[]>`SELECT title, assignee_id FROM review_items WHERE kind = 'conflict'`;
    expect(item?.title).toBe("Possible conflict in Riverside Towers Launch");
    expect(item?.assignee_id).toBe((await f.person("maria")).id);
  });

  it("flags expertise whose newest evidence is older than 180 days, for the person to confirm", async () => {
    const [item] = await f.db<{ title: string; assignee_id: string }[]>`SELECT title, assignee_id FROM review_items WHERE kind = 'stale'`;
    expect(item?.title).toBe("Is Boris Marinov still an expert in Power BI?");
    expect(item?.assignee_id).toBe((await f.person("boris")).id);
  });

  it("is idempotent: re-running sync and maintenance creates nothing new", async () => {
    const before = await f.db`SELECT count(*)::int AS n FROM review_items`;
    const stats = await runSync(f.db, new SampleConnector());
    expect(stats.sourcesNew).toBe(0);
    const again = await runMaintenance(f.db, NOW);
    expect(again).toEqual({ conflicts: 0, stale: 0 });
    const after = await f.db`SELECT count(*)::int AS n FROM review_items`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("confirming a conflict retires the older decision", async () => {
    const [item] = await f.db<{ id: string; relationship_ids: string[] }[]>`SELECT id, relationship_ids FROM review_items WHERE kind = 'conflict'`;
    await resolveReviewItem(f.db, { itemId: item!.id, action: "confirm", resolverId: (await f.person("maria")).id });
    const rels = await f.db<{ id: string; status: string }[]>`SELECT id, status FROM relationships WHERE id = ANY(${item!.relationship_ids}::uuid[])`;
    const byId = new Map(rels.map((r) => [r.id, r.status]));
    expect(byId.get(item!.relationship_ids[0]!)).toBe("retired");
    expect(byId.get(item!.relationship_ids[1]!)).toBe("active");
    await expect(
      resolveReviewItem(f.db, { itemId: item!.id, action: "confirm", resolverId: (await f.person("maria")).id }),
    ).rejects.toThrow(/already resolved/);
  });

  it("confirming stale expertise refreshes it", async () => {
    const [item] = await f.db<{ id: string; relationship_ids: string[] }[]>`SELECT id, relationship_ids FROM review_items WHERE kind = 'stale'`;
    await resolveReviewItem(f.db, { itemId: item!.id, action: "confirm", resolverId: (await f.person("boris")).id });
    const [rel] = await f.db<{ valid_from: Date }[]>`SELECT valid_from FROM relationships WHERE id = ${item!.relationship_ids[0]!}`;
    expect(Date.now() - rel!.valid_from.getTime()).toBeLessThan(60_000);
  });
});
