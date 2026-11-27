import type { Connector } from "../../ingest/types.js";
import { SAMPLE_DIRECTORY, SAMPLE_EMAILS, SAMPLE_MEETINGS } from "./data.js";

/** Serves the fictional "Acme Properties" dataset. Used for local development and tests. */
export class SampleConnector implements Connector {
  readonly name = "sample";
  async fetchDirectory() {
    return SAMPLE_DIRECTORY;
  }
  async fetchMeetings() {
    return SAMPLE_MEETINGS;
  }
  async fetchEmails() {
    return SAMPLE_EMAILS;
  }
}
