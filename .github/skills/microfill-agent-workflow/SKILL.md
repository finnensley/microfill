---
name: microfill-agent-workflow
description: "Use when working on the MicroFill codebase: planning changes, editing inventory or webhook flows, updating dashboard operator UX, validating Shopify or ShipHero integrations, or continuing project work from PROJECT_STATUS.md. Covers the local-first Supabase workflow, focused validation, tunnel handling, integration safety, and repo guardrails for high-signal AI agent execution."
user-invocable: true
---

# MicroFill Agent Workflow

## Purpose

Use this skill for day-to-day AI agent work in MicroFill so changes follow the current repo workflow instead of a generic coding loop.

This skill is designed for:

- continuing work from the current project status
- editing dashboard, inventory, integration, and webhook code
- validating Shopify and ShipHero paths safely
- working with the local Supabase stack and seeded data
- keeping changes narrow, test-backed, and operationally reversible

## When To Use

Load this skill when the task involves any of the following:

- PROJECT_STATUS driven implementation
- dashboard or operator workflow changes
- inventory API or audit history changes
- Shopify or ShipHero webhook handling
- local webhook replay or live smoke validation
- Supabase local development workflow
- deciding what to validate after a change

## Core Workflow

1. Start from the current anchor.

- Prefer a named file, route, test, script, error, or project-status task.
- If the user says "continue" or "next step," inspect PROJECT_STATUS.md first and continue from the next unresolved milestone.

2. Work local-first.

- Default to the local Docker-backed Supabase flow.
- Use the local seed data and tenant-scoped demo records before attempting live integrations.
- Do not assume hosted infrastructure is available.

3. Read narrowly before editing.

- Read the smallest set of files needed to state one local hypothesis.
- Favor the owning route, hook, service, or test over broad exploration.
- If the task involves integrations, inspect the relevant replay or live-validation script before changing runtime behavior.

4. Make the smallest plausible edit.

- Prefer incremental changes over large refactors.
- Preserve existing API shapes and UI language unless the task requires otherwise.
- Avoid unrelated cleanup while touching integration or inventory-critical code.

5. Validate immediately after the first substantive edit.

- Prefer focused test files first.
- Prefer file-level or route-level validation over full-repo checks.
- If the task touches webhook handlers or dashboard APIs, run the narrowest relevant Vitest files.

6. Update project truth when milestones change.

- If a task materially changes the execution state, update PROJECT_STATUS.md.
- Keep README updates for runbooks or operator-facing workflows, not minor internal edits.

## Repo-Specific Guardrails

### Local Environment

- Use `npm run supabase:start`, `npm run supabase:env`, and `npm run supabase:reset` for local database workflow.
- Local stack config lives in `supabase/config.toml`.
- Local seed data lives in `supabase/seed.sql`.
- Generated Supabase types live in `src/types/supabase.ts` via `npm run supabase:types`.
- Pushing migrations to hosted Supabase always requires the DB password env var: `SUPABASE_DB_PASSWORD=pawtoj-byfJu4-vafbog npm run supabase:push`. Without it, the CLI will fail with a login role 400 error.
- If `db push` fails with `duplicate key value violates unique constraint "schema_migrations_pkey"`, the column already exists but tracking is missing. Fix with: `SUPABASE_DB_PASSWORD=... npx supabase migration repair --status applied <version> --linked`

### Validation Defaults

- Use `npm test -- <focused test file>` after changing a route, integration flow, or dashboard-backed data path.
- Webhook changes should usually validate against `tests/api/webhooks-route.test.ts`.
- Inventory, audit, or integration API changes should usually validate against `tests/api/inventory-routes.test.ts` and `tests/api/integrations-route.test.ts` as applicable.
- Use broader `npm test` only when the change spans multiple areas or the focused tests are insufficient.

### Webhook Workflow

- Test saved payloads before attempting live delivery.
- Replay locally with:
  - `npm run webhook:replay:shopify`
  - `npm run webhook:replay:shiphero:po`
  - `npm run webhook:replay:shiphero:shipment`
- For live-style checks, use the helper scripts instead of improvising manual curl flows:
  - `npm run webhook:shopify:live:prepare`
  - `npm run webhook:shopify:live:smoke`
  - `npm run webhook:shopify:live:verify`
  - `npm run webhook:shiphero:live:prepare`
  - `npm run webhook:shiphero:live:smoke`
  - `npm run webhook:shiphero:live:verify`

### Outbound Shopify Inventory Sync

- The sync service is at `src/services/shopify-sync.ts`. It requires three fields on the tenant's active Shopify integration record: `api_key` (Admin API access token), `external_shop_domain`, and `config.shopifyLocationId`.
- The Admin API access token starts with `shpat_` — get it from Shopify Admin → Settings → Apps and sales channels → Develop apps → your app → API credentials → Reveal token. It is only shown once; if missed, uninstall and reinstall the app.
- The API secret key (`shpss_`) is NOT the access token and will not work for REST calls.
- To check current config and item eligibility: `npm run shopify:sync:verify`
- To preview what would be written: `npm run shopify:sync:dry-run`
- To write credentials from `.env.local` into the hosted integration record: `NEXT_PUBLIC_SUPABASE_URL=https://czaxkduxoufxeaosuqoy.supabase.co SUPABASE_SERVICE_ROLE_KEY=<hosted key> npm run shopify:sync:apply`
- Required `.env.local` vars for apply: `SHOPIFY_OUTBOUND_ACCESS_TOKEN`, `SHOPIFY_OUTBOUND_LOCATION_ID`, `SHOPIFY_OUTBOUND_SHOP_DOMAIN`
- Known values: location ID = `82250760358`, shop domain = `microfill-2.myshopify.com`
- Alternatively, paste the token into the dashboard → Integrations → Shopify → API key field → Save.

### Tunnel Safety

- Only use public tunnels for real webhook callback testing.
- Keep day-to-day UI and database work local.
- Cloudflare quick tunnel URLs are ephemeral; if a tunnel changes or closes, rerun the matching `:live:smoke` command before treating the path as healthy.
- Treat a successful smoke test as proof of public reachability, not proof of real provider delivery.

### Provider Credential Safety

- Do not claim live provider validation unless a real external delivery succeeded.
- Distinguish clearly between:
  - recorded fixture replay
  - live smoke against the public tunnel
  - actual provider-initiated webhook delivery
- Do not overwrite credential placeholders or `.env.local` values blindly; inspect current values first.
- Avoid broad edits to `.env.local`; change only the specific keys required for the task.

### Inventory And Operator UX

- Preserve tenant scoping for inventory, audit history, and integration management.
- Treat `audit_logs` and reconciliation surfaces as operator safety features, not decoration.
- Favor UI changes that improve exception handling, traceability, and recovery guidance.

## Recommended Agent Procedure

### For Project-Status Continuation

1. Read PROJECT_STATUS.md.
2. Identify the next unchecked or blocked milestone.
3. Confirm the nearest controlling code path and cheapest discriminating validation.
4. Implement the smallest change that advances that milestone.
5. Run focused validation.
6. Update PROJECT_STATUS.md if the milestone state changed.

### For Webhook Or Integration Work

1. Read the route, related types, and the closest route test.
2. Check whether a replay or live helper script already covers the path.
3. Keep signature, tenant-resolution, and provider-envelope handling backward compatible where practical.
4. Validate with the focused webhook test file.
5. Only then run replay or smoke tooling if the task requires executable integration confirmation.

### For Dashboard Work

1. Read the dashboard component and the backing hook or route.
2. Prefer extending existing operator panels over adding parallel UI surfaces.
3. Keep copy operational and concrete.
4. Validate file errors and the relevant API tests.

## Industry-Standard Execution Guardrails

- Prefer deterministic, testable edits over speculative architectural churn.
- Keep one active hypothesis at a time.
- Use the narrowest possible validation before widening scope.
- Separate confirmed facts from assumptions in user-facing updates.
- Treat integration status, audit history, and retry guidance as production-adjacent operational data.
- Avoid destructive commands, silent secret rewrites, and unrelated refactors in a dirty working tree.
- Never mark a provider workflow complete based only on mocked, replayed, or tunnel-only traffic.

## Done Criteria

A change is only complete when all relevant items are true:

- the code change is implemented at the controlling abstraction
- the narrowest relevant validation passed
- user-facing or operator-facing state is still coherent
- project status or runbook docs are updated if the milestone changed
- remaining blockers are stated explicitly if external credentials or providers are still required
