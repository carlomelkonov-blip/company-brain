# Company Brain — guide for coding sessions

Read `README.md` for setup and `docs/PRD.md` for product scope. Architecture decisions live in `docs/adr/`.

## Non-negotiables

1. **Access rules first.** Any query that returns content (sources, chunks, decisions, action items, evidence links)
   must apply `openableSourcesFilter` (SQL) or `canOpenSource` (TS) from `apps/api/src/access/scope.ts`.
   Project lists must filter by `scope.projectIds`; person details by `scope.personIds`.
   The org chart and expertise summaries are the only company-wide data.
2. **Never send content to the AI before access filtering.** Retrieval happens under the viewer's scope; the AI only
   sees what that query returned.
3. **Every fact has a source.** Relationships carry `source_id`, `confidence`, `valid_from` / `valid_to`.
4. **One database per customer.** Tenant code uses the request's `db`; the control database never holds content.
5. **Add a leak test** in `apps/api/test/access.test.ts` or `http.test.ts` for every new endpoint or content path.

## Conventions

- TypeScript strict, ES modules, `.js` extensions in API imports (compiled with NodeNext).
- SQL via postgres.js tagged templates only (no string concatenation). Schema changes = new numbered file in
  `apps/api/src/db/migrations/{control,tenant}/`; never edit an applied migration.
- Connectors only return data (`ingest/types.ts`); they never write to the database.
- Offline mode must keep working: every AI call needs a deterministic fallback.
- Keep UI copy plain and short; explain hidden content instead of silently omitting it.

## Commands

`pnpm dev` · `pnpm seed` · `pnpm test` (needs Postgres; see README) · `pnpm typecheck` · `pnpm build`
