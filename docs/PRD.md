# Company Brain — PRD summary (v0.3)

The full, living PRD is maintained as a shared document (Company Brain — MVP PRD). This file summarises what the
code implements so the repository stands on its own.

## Product

An AI knowledge layer for businesses of 10–200 people. It turns meetings, email and the org chart into a knowledge
graph and answers questions about people, expertise, projects and decisions, with citations. The wedge is
**maintenance**: it detects stale and conflicting knowledge and asks the right person to confirm.

## Data sources and rules

- **Company Brain account** (`companybrain@customer.com`): auto-invited to qualifying meetings; signed in as that user,
  we read only its own chats and files shared with it.
- **Microsoft Teams:** the Facilitator notes Loop file; if a meeting has no Facilitator notes, its transcript.
- **Google Meet:** the post-meeting transcript.
- **Email:** Outlook and Gmail. **Org chart:** Entra ID / Google directory.
- **Project rule:** each meeting name defines a Project; attendees are members; recurring meetings share one project;
  generic names (e.g. "Weekly sync") are excluded.

## Access model

| You ask about | Allowed when |
| --- | --- |
| A person | It is you, they are below you in the org chart, or you share a project |
| A project | You are a member, or someone below you is a member |
| Notes, transcripts, emails | Belongs to a project/person you may access **and** you can open it in the source tool |
| Org chart | Always |
| Expertise | Always, with evidence summaries; evidence links only when you can open the source |

## Tenancy

One database per customer at `customer.companybrain.com`, plus a control database listing customers. Sign-in with
Microsoft or Google work accounts (v1: dev sign-in).

## MVP scope implemented in v1

Tenancy (T1), graph build (G1), ask with citations (A1–A6), org chart and person/project pages (E1–E2), maintenance
loop (M1–M2), admin status and exclusions (C6–C7 partially), sample connector. Not yet: real connectors (C1–C5),
SSO (T2), Bulgarian answers (A7), freshness scores (M3).
