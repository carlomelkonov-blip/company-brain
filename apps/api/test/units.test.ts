import { describe, expect, it } from "vitest";
import { cleanMeetingTitle, mentionsProject, normalizeMeetingName } from "../src/graph/projects.js";
import { heuristicExtract } from "../src/ingest/extract.js";
import { pickMeetingContent, chunkText } from "../src/ingest/pipeline.js";
import { decodeSession, encodeSession } from "../src/auth/session.js";
import { tenantSlugFromHost } from "../src/tenancy/tenants.js";
import { detectIntent } from "../src/ask/ask.js";

describe("project rule: meeting names", () => {
  it.each([
    ["Riverside Towers Launch - Nov 17", "Riverside Towers Launch"],
    ["Board Prep Q4 (2026-11-14 at 09:00 EET) - Transcript", "Board Prep Q4"],
    ["CRM Migration 2026-11-12", "CRM Migration"],
    ["Team Sync (2022-9-13 at 10:00 PST) - Transcript", "Team Sync"],
    ["Budget review 17 November 2026", "Budget review"],
  ])("%s -> %s", (title, expected) => {
    expect(cleanMeetingTitle(title)).toBe(expected);
  });

  it("recurring meetings with dates in the title map to one project", () => {
    expect(normalizeMeetingName("Riverside Towers Launch")).toBe(normalizeMeetingName("Riverside Towers Launch - Nov 17"));
  });

  it("links an email subject to a project by its distinctive words", () => {
    expect(mentionsProject("riverside towers price list v3", "riverside towers launch")).toBe(true);
    expect(mentionsProject("draft 2027 budget", "riverside towers launch")).toBe(false);
  });
});

describe("Teams content choice", () => {
  const base = { externalId: "x", title: "t", startsAt: "2026-01-01T00:00:00Z", organizerEmail: "a@x", attendeeEmails: [] };
  it("prefers Facilitator notes", () => {
    expect(pickMeetingContent({ ...base, platform: "teams", facilitatorNotes: "notes", transcript: "tr" })?.kind).toBe("facilitator_notes");
  });
  it("falls back to the transcript when there are no notes", () => {
    expect(pickMeetingContent({ ...base, platform: "teams", transcript: "tr" })?.kind).toBe("teams_transcript");
  });
  it("uses the Meet transcript for Google meetings", () => {
    expect(pickMeetingContent({ ...base, platform: "meet", transcript: "tr" })?.kind).toBe("meet_transcript");
  });
  it("records nothing when there is no content", () => {
    expect(pickMeetingContent({ ...base, platform: "teams" })).toBeNull();
  });
});

describe("offline extraction", () => {
  const attendees = [
    { email: "petar@acme.test", name: "Petar Nikolov" },
    { email: "georgi@acme.test", name: "Georgi Ivanov" },
    { email: "kalina@acme.test", name: "Kalina Hristova" },
  ];
  it("finds decisions in speaker lines and decision sections", () => {
    const r = heuristicExtract("Georgi: Decision: we go live on 1 February.\n\nDecisions\n- Budget approved.", attendees);
    expect(r.decisions.map((d) => d.text)).toEqual(["we go live on 1 February.", "Budget approved."]);
  });
  it("attributes expertise to the speaker and to people named in the line", () => {
    const r = heuristicExtract("Petar: I own the Jira board.\nNotes\n- Kalina has run Google Ads campaigns.", attendees);
    expect(r.expertise.map((e) => `${e.email}:${e.skill}`)).toEqual(["petar@acme.test:Jira", "kalina@acme.test:Google Ads"]);
  });
  it("assigns action items to the named owner", () => {
    const r = heuristicExtract("Action items\n- Kalina to prepare the campaign.", attendees);
    expect(r.actionItems[0]?.ownerEmail).toBe("kalina@acme.test");
  });
});

describe("sessions", () => {
  it("round-trips and rejects tampering and expiry", () => {
    const token = encodeSession({ tenant: "acme", personId: "p1" });
    expect(decodeSession(token)?.personId).toBe("p1");
    expect(decodeSession(token.replace(/.$/, (ch) => (ch === "A" ? "B" : "A")))).toBeNull();
    expect(decodeSession(token, Date.now() + 13 * 3600 * 1000)).toBeNull();
  });
});

describe("tenant from host", () => {
  it.each([
    ["acme.companybrain.com", "acme"],
    ["acme.localhost:5173", "acme"],
    ["globex.companybrain.com:443", "globex"],
  ])("%s -> %s", (host, slug) => {
    expect(tenantSlugFromHost(host)).toBe(slug);
  });
});

describe("intent detection", () => {
  it.each([
    ["Who knows Jira?", "expertise"],
    ["Is anyone an expert in SEO?", "expertise"],
    ["Who does Petar report to?", "org"],
    ["What did we decide about the launch date?", "search"],
  ])("%s -> %s", (q, intent) => {
    expect(detectIntent(q)).toBe(intent);
  });
});

describe("chunking", () => {
  it("keeps short content as one chunk and splits long content", () => {
    expect(chunkText("short")).toEqual(["short"]);
    expect(chunkText("x".repeat(2000)).length).toBeGreaterThan(1);
  });
});
