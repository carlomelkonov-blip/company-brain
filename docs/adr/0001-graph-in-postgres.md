# ADR-0001: Store the knowledge graph in Postgres

Status: accepted (2026-11-28)

## Context
We need a graph of people, projects, meetings, decisions and skills, plus full-text (later vector) search, plus
access checks on every query. Typical questions are 2–3 hops.

## Decision
Keep the graph in each customer's Postgres database as `entities` and `relationships` tables, next to `sources`,
`chunks` and the org chart. Use recursive queries for hierarchy and project traversal.

## Consequences
- One system per customer; access checks and graph lookups run in the same query.
- No second database to operate or keep in sync.
- Revisit if we need deep multi-hop analytics or graph algorithms at large scale; the two-table graph exports easily.
