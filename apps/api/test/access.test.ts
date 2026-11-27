import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask } from "../src/ask/ask.js";
import { createFixture, projectIdByName, type Fixture } from "./helpers.js";

/**
 * Leak tests for the access model (PRD "Access model"). Sample company (Acme Properties):
 *   Elena (CEO) ── Georgi (COO) ── Dimitar ── Petar, Ralitsa ; Teodora
 *               ── Maria (Sales) ── Nikolay, Iva, Kalina
 *               ── Boris (CFO)
 * Projects come from meeting names; Weekly sync is excluded.
 */
let f: Fixture;
beforeAll(async () => { f = await createFixture(); });
afterAll(async () => { await f.teardown(); });

describe("project visibility", () => {
  it("a member sees their project but not others", async () => {
    const s = await f.scopeOf("nikolay");
    expect(s.projectIds.has(await projectIdByName(f.db, "Riverside Towers Launch"))).toBe(true);
    expect(s.projectIds.has(await projectIdByName(f.db, "Board Prep Q4"))).toBe(false);
    expect(s.projectIds.has(await projectIdByName(f.db, "CRM Migration"))).toBe(false);
    expect(s.projectIds.has(await projectIdByName(f.db, "Website Redesign"))).toBe(false);
  });

  it("a manager sees projects their reports belong to", async () => {
    const s = await f.scopeOf("maria");
    // Kalina and Iva (Maria's reports) are in Website Redesign; Maria is not.
    expect(s.projectIds.has(await projectIdByName(f.db, "Website Redesign"))).toBe(true);
    expect(s.projectIds.has(await projectIdByName(f.db, "CRM Migration"))).toBe(false);
    expect(s.projectIds.has(await projectIdByName(f.db, "Board Prep Q4"))).toBe(false);
  });

  it("the CEO sees every project through the hierarchy", async () => {
    const s = await f.scopeOf("elena");
    for (const name of ["Riverside Towers Launch", "CRM Migration", "Board Prep Q4", "Website Redesign", "Q1 Reporting Review"]) {
      expect(s.projectIds.has(await projectIdByName(f.db, name))).toBe(true);
    }
  });

  it("excluded meeting names never become projects", async () => {
    const rows = await f.db`SELECT 1 FROM entities WHERE type = 'project' AND normalized_name = 'weekly sync'`;
    expect(rows).toHaveLength(0);
  });
});

describe("people visibility", () => {
  it("includes self, reports and project co-members, but not people above", async () => {
    const s = await f.scopeOf("nikolay");
    const ids = async (...locals: string[]) => Promise.all(locals.map(async (l) => (await f.person(l)).id));
    for (const id of await ids("nikolay", "maria", "kalina", "dimitar", "iva")) expect(s.personIds.has(id)).toBe(true);
    for (const id of await ids("elena", "boris", "georgi", "petar")) expect(s.personIds.has(id)).toBe(false);
  });

  it("a manager sees everyone below them at any depth", async () => {
    const s = await f.scopeOf("georgi");
    for (const l of ["dimitar", "petar", "ralitsa", "teodora"]) expect(s.subordinateIds.has((await f.person(l)).id)).toBe(true);
    expect(s.subordinateIds.has((await f.person("elena")).id)).toBe(false);
  });
});

describe("answers never leak content", () => {
  it("a sales manager cannot learn the board's budget assumption", async () => {
    const r = await ask(f.db, await f.scopeOf("nikolay"), "What revenue growth does the 2027 budget assume?");
    expect(r.answer).not.toMatch(/12%/);
    // Nothing he may open is about the budget: an honest "not found", not unrelated notes that mention 2027.
    expect(r.citations).toHaveLength(0);
    expect(r.answer).toMatch(/couldn't find/);
  });

  it("the CFO, who attended, gets it with a citation", async () => {
    const r = await ask(f.db, await f.scopeOf("boris"), "What revenue growth does the 2027 budget assume?");
    expect(r.answer).toMatch(/12%/);
    expect(r.citations.length).toBeGreaterThan(0);
  });

  it("the CEO sees the CRM project exists but cannot read a meeting she did not attend", async () => {
    const r = await ask(f.db, await f.scopeOf("elena"), "When do we go live with the new CRM?");
    expect(r.answer).not.toMatch(/1 February/);
  });

  it("a project member gets the latest launch date with citations", async () => {
    const r = await ask(f.db, await f.scopeOf("nikolay"), "What is the Riverside Towers launch date?");
    expect(r.answer).toMatch(/29 March/);
    expect(r.citations.every((c) => c.projectName === "Riverside Towers Launch" || c.projectName === null)).toBe(true);
  });

  it("emails are readable only by their sender and recipients", async () => {
    const asIva = await ask(f.db, await f.scopeOf("iva"), "partner commission price list");
    expect(asIva.answer).not.toMatch(/3%/);
    const asMaria = await ask(f.db, await f.scopeOf("maria"), "partner commission price list");
    expect(asMaria.answer).toMatch(/3%/);
  });
});

describe("expertise is company-wide, evidence follows the content rule", () => {
  it("anyone can find the Jira expert", async () => {
    const r = await ask(f.db, await f.scopeOf("nikolay"), "Who knows Jira?");
    expect(r.intent).toBe("expertise");
    expect(r.experts?.[0]?.name).toBe("Petar Nikolov");
  });

  it("evidence summaries are shown, but links only to sources the asker can open", async () => {
    const outsider = await ask(f.db, await f.scopeOf("nikolay"), "Who knows Jira?");
    expect(outsider.experts?.[0]?.evidence.length).toBeGreaterThan(0);
    expect(outsider.citations).toHaveLength(0);
    const attendee = await ask(f.db, await f.scopeOf("dimitar"), "Who knows Jira?");
    expect(attendee.citations.length).toBeGreaterThan(0);
  });
});

describe("org chart is visible to everyone", () => {
  it("answers reporting-line questions for anyone", async () => {
    const r = await ask(f.db, await f.scopeOf("iva"), "Who does Boris report to?");
    expect(r.intent).toBe("org");
    expect(r.answer).toMatch(/reports to Elena Petrova/);
  });
});
