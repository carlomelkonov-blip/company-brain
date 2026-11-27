# ADR-0003: The Company Brain account reads meetings as an attendee

Status: accepted (2026-11-28)

## Context
Options considered: a bot that joins calls with audio; Microsoft's Meeting AI Insights API (beta, needs a Copilot
license on the reader); tenant-wide transcript access; browser automation of Teams.

## Decision
Each customer has a `companybrain@` user, auto-invited to qualifying meetings. Signed in as that user, we read only
its own chats and files shared with it: the Facilitator notes Loop file (Teams), the transcript when there are no
notes (Teams), and the post-meeting transcript (Google Meet).

## Consequences
- No extra licenses on the account; no beta APIs; it sees exactly what a human attendee sees.
- A Copilot-licensed organizer must turn on Facilitator; otherwise we fall back to the transcript.
- Loop-to-text conversion and participant access must be proven in the week-1 access test.
