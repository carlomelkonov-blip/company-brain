# Company Brain

A permission-aware knowledge graph of your company. It connects meetings, email and the org chart, and answers
questions about people, expertise, projects and decisions — with a source for every claim, and only from content
the person asking is allowed to see.

> **Status: v1 (local MVP).** Runs fully on your machine against a realistic sample company ("Acme Properties").
> The Microsoft 365 and Google Workspace connectors are scaffolded but not yet implemented; see
> [docs/week1-access-test.md](docs/week1-access-test.md). Product spec: [docs/PRD.md](docs/PRD.md).

## What v1 does

| Area | In v1 |
| --- | --- |
| Tenancy | One database per customer, plus a small control database; workspace chosen by subdomain (`acme.localhost`) |
| Sign-in | Dev sign-in (pick a person from the directory). Microsoft / Google sign-in buttons are placeholders |
| Graph | People, projects (from meeting names), meetings, decisions, action items, skills — every fact linked to its source |
| Access rules | Hierarchy + project membership + source ACLs, enforced inside every database query; org chart and expertise open to all |
| Ask | Chat with citations: expertise ("Who knows Jira?"), org ("Who does Petar report to?") and search questions |
| Maintenance | Detects conflicting decisions and stale expertise; owners confirm, correct or retire in one click; users flag wrong answers |
| Admin | Sync status, run a sync, edit meeting names that never become projects |
| AI | Anthropic Claude when `ANTHROPIC_API_KEY` is set; otherwise **offline mode** with deterministic extraction and answers |

## Quick start

Requirements: Node.js 22+, pnpm 10+, and Docker (or any local PostgreSQL 16).

```bash
cp .env.example .env            # then set SESSION_SECRET (openssl rand -hex 32)
docker compose up -d            # local Postgres on :5432 (user/password: postgres)
pnpm install
pnpm seed                       # creates the control DB, the "acme" workspace and loads the sample company
pnpm dev                        # API on :8787, web on :5173
```

Open **http://acme.localhost:5173**, sign in as anyone, and ask a question. Sign in as different people to see the
access rules at work:

| Sign in as | Try asking | What you should see |
| --- | --- | --- |
| Nikolay (Sales Manager) | What is the Riverside Towers launch date? | 29 March 2027 (changed from 15 March), with citations |
| Nikolay | What revenue growth does the 2027 budget assume? | Nothing: the board meeting and budget email are not his |
| Boris (CFO) | Same question | 12%, cited from the board prep transcript |
| Anyone | Who knows Jira? | Petar, with evidence; links only if you attended the meeting |
| Maria (Head of Sales) | Review tab | A launch-date conflict to resolve |
| Georgi (COO, admin) | Admin tab | Sync status, counts, project exclusions |

Optional: set `ANTHROPIC_API_KEY` in `.env` for AI extraction and natural-language answers, then re-run `pnpm seed`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | API (tsx watch) and web (Vite) together |
| `pnpm seed` | Create/refresh the demo workspace from the sample connector |
| `pnpm db:setup` | Create and migrate the control database only |
| `pnpm test` | API unit and integration tests (needs Postgres) |
| `pnpm typecheck` / `pnpm build` | Type-check / build both apps |

## Architecture

```
apps/
  api/   Hono + postgres.js (TypeScript)
    src/tenancy/      control DB, subdomain → workspace, provisioning (one database per customer)
    src/access/       the access model: who can see which people, projects and content
    src/ingest/       connector contract, pipeline (project rule, sources, chunks), extraction
    src/connectors/   sample (Acme Properties), microsoft (scaffold), google (scaffold)
    src/ask/          intent detection, retrieval under access rules, answers with citations
    src/maintenance/  conflict + stale detection, review resolution
    src/http/         routes and middleware
    src/db/migrations control/ and tenant/ SQL migrations
  web/   React + Vite: Ask, People (org chart), Projects, Review, Admin
docs/    PRD summary, architecture decisions (ADRs), week-1 access test plan
```

Key decisions are recorded in [docs/adr](docs/adr). In short: the graph lives in each customer's own Postgres
database; every query applies the access rules before any content reaches the AI; the "Company Brain" account reads
meetings as a normal attendee.

## Not in v1 (next)

1. Microsoft 365 and Google Workspace connectors, starting with the week-1 access test.
2. Real sign-in with Microsoft and Google (OpenID Connect), replacing dev sign-in.
3. Vector search (pgvector) alongside full-text search.
4. Calendar watcher that auto-invites the Company Brain account.
5. Hosted deployment on the free-tier stack.

## Security notes

- Never commit `.env`. Set `ALLOW_DEV_LOGIN=false` and a strong `SESSION_SECRET` anywhere outside your machine.
- Access rules are tested in `apps/api/test/access.test.ts` and `http.test.ts`; add a test for every new content path.
