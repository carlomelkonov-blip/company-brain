/**
 * Starter skill vocabulary for the offline (no-AI) extractor and for matching expertise questions.
 * With an AI provider configured, extraction also finds skills outside this list.
 */
export const SKILLS: { name: string; aliases: string[] }[] = [
  { name: "Jira", aliases: ["jira"] },
  { name: "Confluence", aliases: ["confluence"] },
  { name: "Salesforce", aliases: ["salesforce"] },
  { name: "HubSpot", aliases: ["hubspot"] },
  { name: "CRM", aliases: ["crm", "crm migration"] },
  { name: "React", aliases: ["react"] },
  { name: "TypeScript", aliases: ["typescript"] },
  { name: "Figma", aliases: ["figma"] },
  { name: "SEO", aliases: ["seo", "search engine optimisation", "search engine optimization"] },
  { name: "Google Ads", aliases: ["google ads", "adwords"] },
  { name: "Power BI", aliases: ["power bi", "powerbi"] },
  { name: "Excel", aliases: ["excel"] },
  { name: "Financial modeling", aliases: ["financial model", "financial modelling", "financial modeling"] },
  { name: "Budgeting", aliases: ["budget", "budgeting"] },
  { name: "Pricing", aliases: ["price list", "pricing"] },
  { name: "Contract negotiation", aliases: ["contract negotiation", "negotiation"] },
  { name: "Recruiting", aliases: ["recruiting", "recruitment", "hiring"] },
  { name: "Construction permits", aliases: ["permit", "permits"] },
  { name: "AWS", aliases: ["aws", "amazon web services"] },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchers = SKILLS.map((s) => ({
  name: s.name,
  re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${s.aliases.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "iu"),
}));

export function skillsMentioned(text: string): string[] {
  return matchers.filter((m) => m.re.test(text)).map((m) => m.name);
}
