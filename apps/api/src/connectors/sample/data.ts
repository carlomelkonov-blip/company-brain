import type { DirectoryPerson, EmailMessage, MeetingArtifact } from "../../ingest/types.js";

/**
 * "Acme Properties": a fictional property developer used for local development, demos and the
 * access-control tests. All people, emails and figures are invented. Domain: acme.test
 */

const d = (local: string) => `${local}@acme.test`;

export const SAMPLE_DIRECTORY: DirectoryPerson[] = [
  { email: d("elena"), name: "Elena Petrova", title: "CEO", team: "Leadership" },
  { email: d("georgi"), name: "Georgi Ivanov", title: "COO", team: "Operations", managerEmail: d("elena"), isAdmin: true },
  { email: d("maria"), name: "Maria Dimitrova", title: "Head of Sales", team: "Sales", managerEmail: d("elena") },
  { email: d("boris"), name: "Boris Marinov", title: "CFO", team: "Finance", managerEmail: d("elena") },
  { email: d("nikolay"), name: "Nikolay Stoyanov", title: "Sales Manager", team: "Sales", managerEmail: d("maria") },
  { email: d("iva"), name: "Iva Georgieva", title: "Sales Associate", team: "Sales", managerEmail: d("maria") },
  { email: d("kalina"), name: "Kalina Hristova", title: "Marketing Lead", team: "Marketing", managerEmail: d("maria") },
  { email: d("dimitar"), name: "Dimitar Kolev", title: "Head of Engineering", team: "Engineering", managerEmail: d("georgi") },
  { email: d("petar"), name: "Petar Nikolov", title: "Software Engineer", team: "Engineering", managerEmail: d("dimitar") },
  { email: d("ralitsa"), name: "Ralitsa Todorova", title: "Frontend Engineer", team: "Engineering", managerEmail: d("dimitar") },
  { email: d("teodora"), name: "Teodora Angelova", title: "HR Manager", team: "Operations", managerEmail: d("georgi") },
  { email: d("companybrain"), name: "Company Brain", title: "Service account", isServiceAccount: true },
];

export const SAMPLE_MEETINGS: MeetingArtifact[] = [
  {
    externalId: "teams-q1-reporting-2026-03-05",
    platform: "teams",
    title: "Q1 Reporting Review",
    startsAt: "2026-03-05T09:00:00Z",
    organizerEmail: d("boris"),
    attendeeEmails: [d("elena"), d("boris"), d("companybrain")],
    facilitatorNotes: `Summary
Review of the Q1 sales reporting process.

Decisions
- Monthly sales reporting moves to Power BI from April.

Notes
- Boris built the Power BI dashboard for sales reporting.`,
  },
  {
    externalId: "teams-riverside-2026-11-10",
    platform: "teams",
    title: "Riverside Towers Launch",
    startsAt: "2026-11-10T10:00:00Z",
    organizerEmail: d("maria"),
    attendeeEmails: [d("maria"), d("nikolay"), d("kalina"), d("dimitar"), d("companybrain")],
    facilitatorNotes: `Summary
The team reviewed launch readiness for Riverside Towers.

Decisions
- Launch date set to 15 March 2027.
- Price list v3 approved for the first 40 apartments.

Action items
- Kalina to prepare the launch campaign in Google Ads.
- Nikolay to send the price list to the partner agencies.

Notes
- Dimitar confirmed the CRM migration will be finished before launch.
- Kalina has run Google Ads campaigns for the last two launches.`,
  },
  {
    externalId: "teams-crm-migration-2026-11-12",
    platform: "teams",
    title: "CRM Migration",
    startsAt: "2026-11-12T13:00:00Z",
    organizerEmail: d("dimitar"),
    attendeeEmails: [d("dimitar"), d("petar"), d("ralitsa"), d("georgi"), d("companybrain")],
    // No Facilitator in this meeting: the transcript is the fallback.
    transcript: `Dimitar: Let's agree the plan for moving from spreadsheets to the new CRM.
Petar: I've set up the Jira workflows for the migration and I'll own the Jira board.
Ralitsa: I'll build the React screens for the agent portal.
Georgi: Decision: we go live with the new CRM on 1 February 2027.
Petar: I also configured Salesforce sandbox imports last year, so I can handle the data mapping.`,
  },
  {
    externalId: "meet-board-prep-2026-11-14",
    platform: "meet",
    title: "Board Prep Q4 (2026-11-14 at 09:00 EET) - Transcript",
    startsAt: "2026-11-14T07:00:00Z",
    organizerEmail: d("elena"),
    attendeeEmails: [d("elena"), d("boris"), d("georgi"), d("companybrain")],
    transcript: `Elena: We need the Q4 board pack by 5 December.
Boris: Decision: the 2027 budget assumes 12% revenue growth.
Boris: I'll update the financial model in Excel before Friday.
Georgi: Operations headcount stays flat next year.`,
  },
  {
    externalId: "teams-riverside-2026-11-17",
    platform: "teams",
    title: "Riverside Towers Launch - Nov 17",
    startsAt: "2026-11-17T10:00:00Z",
    organizerEmail: d("maria"),
    attendeeEmails: [d("maria"), d("nikolay"), d("kalina"), d("dimitar"), d("iva"), d("companybrain")],
    facilitatorNotes: `Summary
Permit delays affect the launch timeline.

Decisions
- Launch date moved to 29 March 2027 because of permit delays.
- Show apartment opens on 1 March.

Action items
- Iva to book the show apartment photographer.

Notes
- Nikolay handled the contract negotiation with Bulgarian Partner Agency.`,
  },
  {
    externalId: "meet-website-redesign-2026-11-18",
    platform: "meet",
    title: "Website Redesign",
    startsAt: "2026-11-18T12:00:00Z",
    organizerEmail: d("kalina"),
    attendeeEmails: [d("kalina"), d("ralitsa"), d("iva"), d("companybrain")],
    transcript: `Kalina: The new website must improve SEO for apartment listings.
Ralitsa: I'll use React and our design system; the Figma mocks are ready.
Iva: Decision: listing pages show prices in EUR and BGN.`,
  },
  {
    externalId: "teams-weekly-sync-2026-11-19",
    platform: "teams",
    title: "Weekly sync",
    startsAt: "2026-11-19T08:00:00Z",
    organizerEmail: d("georgi"),
    attendeeEmails: [d("georgi"), d("dimitar"), d("teodora"), d("companybrain")],
    facilitatorNotes: `Notes
- Teodora is finalising the recruiting plan for two engineers.`,
  },
];

export const SAMPLE_EMAILS: EmailMessage[] = [
  {
    externalId: "msg-riverside-pricelist",
    subject: "Riverside Towers price list v3",
    sentAt: "2026-11-11T09:30:00Z",
    fromEmail: d("nikolay"),
    toEmails: ["partners@bpa.example"],
    ccEmails: [d("maria")],
    body: "Hi, attached is price list v3 for Riverside Towers. The partner commission stays at 3%. Best, Nikolay",
  },
  {
    externalId: "msg-crm-jira-board",
    subject: "CRM Migration - Jira board ready",
    sentAt: "2026-11-13T15:10:00Z",
    fromEmail: d("petar"),
    toEmails: [d("dimitar")],
    ccEmails: [],
    body: "The Jira board for the CRM migration is ready, with workflows for data mapping and testing.",
  },
  {
    externalId: "msg-draft-budget",
    subject: "Draft 2027 budget",
    sentAt: "2026-11-15T17:45:00Z",
    fromEmail: d("boris"),
    toEmails: [d("elena")],
    ccEmails: [],
    body: "Elena, the draft 2027 budget is in the finance folder. Revenue growth assumption is 12%; marketing spend is up 8%.",
  },
];
