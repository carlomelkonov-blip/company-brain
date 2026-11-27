import { z } from "zod";
import { aiConfigured, completeJson } from "../ai/provider.js";
import { skillsMentioned } from "./skills.js";

export interface Attendee {
  email: string;
  name: string;
}

export interface Extraction {
  decisions: { text: string }[];
  actionItems: { text: string; ownerEmail?: string }[];
  expertise: { email: string; skill: string; evidence: string; confidence: number }[];
}

const extractionSchema = z.object({
  decisions: z.array(z.object({ text: z.string().min(3) })).default([]),
  actionItems: z.array(z.object({ text: z.string().min(3), ownerEmail: z.string().optional() })).default([]),
  expertise: z
    .array(
      z.object({
        email: z.string(),
        skill: z.string().min(1),
        evidence: z.string().min(3),
        confidence: z.number().min(0).max(1).default(0.6),
      }),
    )
    .default([]),
});

const firstName = (name: string) => name.split(/\s+/)[0]!.toLowerCase();

/** "Petar: I set up Jira" -> { speaker: "Petar", text: "I set up Jira" } */
function splitSpeaker(line: string): { speaker?: string; text: string } {
  const m = line.match(/^\s*([\p{Lu}][\p{L}'-]+(?:\s[\p{Lu}][\p{L}'-]+)?):\s+(.*)$/u);
  if (m && !/^(decisions?|action items?|actions?|todo|notes?|summary)$/i.test(m[1]!)) {
    return { speaker: m[1]!, text: m[2]! };
  }
  return { text: line };
}

function findAttendee(attendees: Attendee[], nameish: string | undefined): Attendee | undefined {
  if (!nameish) return undefined;
  const n = nameish.toLowerCase();
  return attendees.find((a) => a.name.toLowerCase() === n || firstName(a.name) === n);
}

function attendeesMentioned(attendees: Attendee[], text: string): Attendee[] {
  return attendees.filter((a) => new RegExp(`(?<![\\p{L}])${firstName(a.name)}(?![\\p{L}])`, "iu").test(text));
}

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Deterministic extractor used offline and as a fallback when the AI call fails. */
export function heuristicExtract(content: string, attendees: Attendee[]): Extraction {
  const out: Extraction = { decisions: [], actionItems: [], expertise: [] };
  let section: "decisions" | "actions" | "other" = "other";
  const seenExpertise = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#*\s*decisions?\s*:?$/i.test(line)) { section = "decisions"; continue; }
    if (/^#*\s*(action items?|actions|next steps)\s*:?$/i.test(line)) { section = "actions"; continue; }
    if (/^#*\s*[\p{L} ]{2,30}:?$/u.test(line) && !line.startsWith("-")) { section = "other"; continue; }

    const { speaker, text: spoken } = splitSpeaker(line);
    const body = spoken.replace(/^[-*•]\s*/, "").trim();

    const decision = body.match(/^decisions?\s*:\s*(.+)$/i);
    const action = body.match(/^(?:action(?: item)?|todo)s?\s*:\s*(.+)$/i);

    if (decision) out.decisions.push({ text: decision[1]!.trim() });
    else if (action) out.actionItems.push(withOwner(action[1]!.trim(), attendees));
    else if (section === "decisions" && line.startsWith("-")) out.decisions.push({ text: body });
    else if (section === "actions" && line.startsWith("-")) out.actionItems.push(withOwner(body, attendees));

    // Expertise: the speaker of a line naming a skill, or attendees named in a line about a skill.
    const skills = skillsMentioned(body);
    if (skills.length === 0) continue;
    const people: { a: Attendee; confidence: number }[] = [];
    const sp = findAttendee(attendees, speaker);
    if (sp) people.push({ a: sp, confidence: 0.7 });
    for (const a of attendeesMentioned(attendees, body)) {
      if (!people.some((p) => p.a.email === a.email)) people.push({ a, confidence: 0.6 });
    }
    for (const { a, confidence } of people) {
      for (const skill of skills) {
        const key = `${a.email}|${skill}`;
        if (seenExpertise.has(key)) continue;
        seenExpertise.add(key);
        out.expertise.push({ email: a.email, skill, evidence: clip(speaker ? `${speaker}: ${body}` : body), confidence });
      }
    }
  }
  return out;
}

function withOwner(text: string, attendees: Attendee[]): { text: string; ownerEmail?: string } {
  const lead = text.split(/\s+/)[0];
  const owner = findAttendee(attendees, lead);
  return owner ? { text, ownerEmail: owner.email } : { text };
}

const SYSTEM = `You extract structured facts from company meeting notes and transcripts.
Return ONLY a JSON object: {"decisions":[{"text"}],"actionItems":[{"text","ownerEmail"?}],"expertise":[{"email","skill","evidence","confidence"}]}.
Rules: only facts explicitly stated; decisions are agreed outcomes; expertise means a person demonstrably knows a tool,
domain or skill (evidence = one short quote or paraphrase, max 200 chars); confidence 0.5-0.9; use only attendee emails given.`;

export async function extract(content: string, attendees: Attendee[]): Promise<{ result: Extraction; mode: "ai" | "offline" }> {
  if (!aiConfigured()) return { result: heuristicExtract(content, attendees), mode: "offline" };
  try {
    const raw = await completeJson<unknown>({
      system: SYSTEM,
      user: `Attendees:\n${attendees.map((a) => `- ${a.name} <${a.email}>`).join("\n")}\n\nContent:\n${content.slice(0, 24_000)}`,
      maxTokens: 2000,
    });
    const parsed = extractionSchema.parse(raw);
    const allowed = new Set(attendees.map((a) => a.email));
    return {
      mode: "ai",
      result: {
        decisions: parsed.decisions,
        actionItems: parsed.actionItems.map((a) => (a.ownerEmail && allowed.has(a.ownerEmail) ? a : { text: a.text })),
        expertise: parsed.expertise.filter((e) => allowed.has(e.email)).map((e) => ({ ...e, evidence: clip(e.evidence) })),
      },
    };
  } catch {
    return { result: heuristicExtract(content, attendees), mode: "offline" };
  }
}
