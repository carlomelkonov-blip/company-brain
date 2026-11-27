# ADR-0005: TypeScript end to end, local-first, free-tier hosting later

Status: accepted (2026-11-28)

## Decision
TypeScript for API (Hono) and web (React + Vite), Postgres for data, Docker for local infrastructure. The MVP runs
locally; hosting later on free tiers (Cloudflare Workers, Neon). The AI provider is a thin, swappable module with an
offline fallback.

## Consequences
- One language for a solo founder; the API framework runs on Node and on Workers.
- Offline mode keeps development and tests free and deterministic.
