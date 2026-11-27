# ADR-0004: Sign in only with Microsoft or Google work accounts

Status: accepted (2026-11-28); v1 ships a dev-only sign-in

## Context
Access rules depend on knowing exactly who the viewer is in the org chart.

## Decision
Production sign-in uses the customer's identity provider (Microsoft Entra ID or Google). The signed-in email must
belong to the workspace's email domains and match a directory entry. v1 uses a dev sign-in, disabled with
`ALLOW_DEV_LOGIN=false`.

## Consequences
- No passwords to store; offboarding in the customer's directory removes access.
- Sessions are signed cookies bound to one workspace.
