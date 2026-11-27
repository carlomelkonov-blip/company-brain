import { NotImplementedError, type Connector, type DirectoryPerson, type EmailMessage, type MeetingArtifact } from "../ingest/types.js";

/**
 * Microsoft 365 connector — SCAFFOLD, NOT YET WORKING.
 *
 * Design (PRD, ADR-003): our app signs in once as the customer's "Company Brain" user
 * (companybrain@customer.com) with delegated permissions and reads only what that user can see:
 *   - its own calendar: the meetings it was auto-invited to (names, attendees, times);
 *   - files shared with it: the Facilitator notes Loop file, stored in the organizer's OneDrive
 *     "Meetings" folder; when a meeting has no Facilitator notes, the meeting transcript instead;
 *   - mail via admin-approved access for Outlook; the directory (Entra ID) for the org chart.
 * No Meeting AI Insights API, no Copilot license on the account, no tenant-wide transcript policy.
 *
 * Open items for the week-1 access test (docs/week1-access-test.md):
 *   1. Locate the Loop notes file for a calendar event as the Company Brain user.
 *   2. Convert the .loop file to plain text reliably (reuse the approach proven in the existing product).
 *   3. Open the Teams transcript as a participant for meetings without Facilitator.
 */
export class MicrosoftConnector implements Connector {
  readonly name = "microsoft365";

  constructor(private readonly opts: { accessToken: () => Promise<string> }) {}

  async fetchDirectory(): Promise<DirectoryPerson[]> {
    void this.opts;
    throw new NotImplementedError("Microsoft 365 directory sync");
  }

  async fetchMeetings(_since?: Date): Promise<MeetingArtifact[]> {
    throw new NotImplementedError("Microsoft 365 meeting notes (Facilitator Loop file / transcript)");
  }

  async fetchEmails(_since?: Date): Promise<EmailMessage[]> {
    throw new NotImplementedError("Outlook mail sync");
  }
}
