# Week-1 access test (before building real connectors)

Goal: prove, on a real Microsoft 365 tenant and a real Google Workspace, that the Company Brain account can read
meeting content as a normal attendee. Build connectors only after every check passes.

## Setup

- Microsoft 365 test tenant with: one Copilot-licensed organizer, the `companybrain@` user (standard seat), Teams.
- Google Workspace (Business Standard or higher) with the `companybrain@` user; transcription enabled.
- An app registration (Microsoft) and OAuth client (Google) with delegated, read-only scopes.

## Checks

| # | Check | Pass when |
| --- | --- | --- |
| 1 | Sign in as companybrain@ and list its calendar events | Events it was invited to are returned with attendees |
| 2 | For a Teams meeting with Facilitator on, locate the notes Loop file shared with the account | File found from the event alone, no manual links |
| 3 | Convert that Loop file to plain text | Headings, decisions and action items survive; reuse the approach from the existing product |
| 4 | For a Teams meeting without Facilitator, open the transcript as a participant | Transcript text retrieved |
| 5 | For a Google Meet meeting, read the post-meeting transcript as a participant | Text retrieved within 24 hours |
| 6 | Organizer sharing restrictions | Clear error the app can show to the admin |
| 7 | Read directory (managers, titles) and mail with the approved scopes | Org chart and messages retrieved |

## Output

A short write-up per check (works / doesn't / workaround), then implement `MicrosoftConnector` and
`GoogleConnector` in `apps/api/src/connectors/` against the `Connector` contract in `ingest/types.ts`.
