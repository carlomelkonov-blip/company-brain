/**
 * Project rule (PRD): the name of each meeting the Company Brain account attends defines a Project,
 * and every attendee is a member. Recurring meetings with the same name map to one project.
 */

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const NOISE_PATTERNS: RegExp[] = [
  // Google: "Team Sync (2022-9-13 at 10:00 PST) - Transcript"
  /\(\s*\d{4}-\d{1,2}-\d{1,2}[^)]*\)/gi,
  /[-–—:|]\s*(?:transcript|meeting transcript|facilitator notes|ai notes|meeting notes|recap)\s*$/gi,
  /\b(?:transcript|facilitator notes|recap)\b/gi,
  // ISO and numeric dates
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g,
  // "Nov 17", "17 November 2026"
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, "gi"),
  // Times
  /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi,
];

/** Display name for the project: the meeting title without dates, times and file suffixes. */
export function cleanMeetingTitle(title: string): string {
  let t = title;
  for (const p of NOISE_PATTERNS) t = t.replace(p, " ");
  t = t.replace(/\s+/g, " ").trim();
  // Drop separators left dangling at either end ("Riverside Towers Launch -").
  t = t.replace(/^[\s\-–—:|,]+|[\s\-–—:|,]+$/g, "").trim();
  return t || title.trim();
}

export function normalizeMeetingName(title: string): string {
  return cleanMeetingTitle(title).toLowerCase().replace(/[^\p{L}\p{N}:\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const GENERIC_WORDS = new Set(
  "launch meeting meetings review sync weekly daily monthly call update status kickoff kick off planning plan prep project team the and for with q1 q2 q3 q4".split(" "),
);

/** The words that identify a project: "riverside towers launch" -> ["riverside", "towers"]. */
export function distinctiveWords(normalizedProjectName: string): string[] {
  return normalizedProjectName.split(" ").filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
}

/** True when text (e.g. an email subject) names the project: all of its distinctive words appear. */
export function mentionsProject(normalizedText: string, normalizedProjectName: string): boolean {
  const words = distinctiveWords(normalizedProjectName);
  if (words.length === 0) return false;
  const textWords = new Set(normalizedText.split(" "));
  return words.every((w) => textWords.has(w));
}

export function isExcludedMeetingName(normalized: string, excluded: Iterable<string>): boolean {
  for (const e of excluded) {
    if (normalized === e) return true;
  }
  return false;
}
