import { NotImplementedError, type Connector, type DirectoryPerson, type EmailMessage, type MeetingArtifact } from "../ingest/types.js";

/**
 * Google Workspace connector — SCAFFOLD, NOT YET WORKING.
 *
 * Design (PRD, ADR-003): signed in as the customer's "Company Brain" user, read:
 *   - its own Google Calendar: meetings it was auto-invited to;
 *   - the post-meeting transcript via the Meet REST API (conferenceRecords.transcripts) as a participant,
 *     or the transcript Doc via the narrow drive.meet.readonly scope;
 *   - Gmail via admin-approved access; the Workspace directory for the org chart.
 * Transcript entries are deleted 30 days after the meeting, so this connector must run at least daily.
 * Fallback if participant access is insufficient: domain-wide delegation, limited to the account's meetings.
 */
export class GoogleConnector implements Connector {
  readonly name = "google-workspace";

  constructor(private readonly opts: { accessToken: () => Promise<string> }) {}

  async fetchDirectory(): Promise<DirectoryPerson[]> {
    void this.opts;
    throw new NotImplementedError("Google Workspace directory sync");
  }

  async fetchMeetings(_since?: Date): Promise<MeetingArtifact[]> {
    throw new NotImplementedError("Google Meet transcripts");
  }

  async fetchEmails(_since?: Date): Promise<EmailMessage[]> {
    throw new NotImplementedError("Gmail sync");
  }
}
