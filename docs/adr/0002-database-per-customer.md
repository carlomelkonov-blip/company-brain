# ADR-0002: One database per customer, plus a control database

Status: accepted (2026-11-28)

## Context
Customers hand us meeting notes and email. A cross-customer leak would end the business.

## Decision
Each customer gets its own Postgres database (`cb_tenant_<slug>`). A small control database lists customers
(subdomain, database name, email domains, status) and holds no content. The workspace is resolved from the subdomain.

## Consequences
- Strongest isolation; offboarding = drop the database (GDPR).
- Schema migrations must run against every customer database (`provisionTenant` / migration runner).
- Connection pools are per customer; fine for tens to hundreds of customers.
