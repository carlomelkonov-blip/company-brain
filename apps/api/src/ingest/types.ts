/** What a connector hands to the ingestion pipeline. Connectors never write to the database. */

export interface DirectoryPerson {
  email: string;
  name: string;
  title?: string;
  team?: string;
  managerEmail?: string;
  isAdmin?: boolean;
  /** The "Company Brain" account itself. Never shown as a person, never signs in. */
  isServiceAccount?: boolean;
}

/**
 * One meeting occurrence the Company Brain account attended.
 * Teams: Facilitator notes (Loop file) when they exist, otherwise the transcript.
 * Google Meet: the post-meeting transcript.
 */
export interface MeetingArtifact {
  externalId: string;
  platform: "teams" | "meet";
  title: string;
  startsAt: string;
  organizerEmail: string;
  attendeeEmails: string[];
  facilitatorNotes?: string;
  transcript?: string;
  url?: string;
}

export interface EmailMessage {
  externalId: string;
  subject: string;
  sentAt: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  body: string;
  url?: string;
}

export interface Connector {
  readonly name: string;
  fetchDirectory(): Promise<DirectoryPerson[]>;
  fetchMeetings(since?: Date): Promise<MeetingArtifact[]>;
  fetchEmails(since?: Date): Promise<EmailMessage[]>;
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (see docs/week1-access-test.md)`);
    this.name = "NotImplementedError";
  }
}
