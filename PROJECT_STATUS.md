# MicroFill Project Status

**Last Updated:** April 30, 2026  
**Stage:** Queue-backed MVP — deployed to production  
**Owner:** soloSoftwareDev LLC

---

## Current Position

MicroFill now has a complete queue-backed webhook pipeline. All verified WMS payloads are enqueued immediately on receipt and processed asynchronously by a Vercel Cron worker at `/api/queue/process`. The ShipHero route returns `{ queued: true }` in under 200 ms and the worker handles normalization, inventory sync, retry scheduling, and dead-letter promotion.

The codebase has 28 unit tests across 4 test files, all passing. Playwright E2E infrastructure is in place. The hosted Supabase project has been reactivated and the pending migrations can be applied with `npm run supabase:push`.

---

## What Works Right Now

### Local Development

- Next.js app runs locally with the Supabase local stack
- Local Supabase config, seed data, scripts, and env workflow are in place

### Database

- `inventory_items`, `integrations`, `audit_logs`, `tenants`, `user_tenant_assignments` schemas
- `webhook_events` queue table (migration `20260429000200`) with `claim_webhook_events` RPC using `SELECT FOR UPDATE SKIP LOCKED` for safe concurrent workers
- Generic `sync_wms_stock_received` / `sync_wms_stock_shipped` RPCs (renamed from ShipHero-specific names)
- RLS enabled on all tables; service-role bypass policy on `webhook_events`

### Auth And Access

- `/login` supports email magic link and OTP
- Middleware protects `/dashboard` and `/onboarding`
- `/api/tenant-assignment` stores tenant assignment

### Dashboard And Data Access

- `/dashboard` renders for authenticated users with inventory, audit history, and reconciliation snapshot
- Integration management UI for Shopify and ShipHero tenant credentials
- Dashboard surfaces ShipHero recovery guidance and exception-focused audit history filters

### Universal WMS Adapter Architecture

- `WmsAdapter` interface is the single integration contract — `hmacHeader`, `verifySignature()`, `normalize()`, `getExternalAccountId()`, `getEnvSecretKey()`
- `WmsProvider` union type (`"shopify" | "shiphero" | "fishbowl" | "netsuite"`) is the single source of truth
- `src/services/wms-adapters/shiphero.ts` — production-ready ShipHero adapter
- `src/services/wms-adapters/shopify.ts` — production-ready Shopify adapter; `normalize()` returns `order_committed` events keyed by variant ID
- `src/services/wms-adapters/fishbowl.ts` — Fishbowl stub (registered, safe stub that returns `false` from `verifySignature` until implemented)
- Adapter registry at `src/services/wms-adapters/index.ts`
- `InventoryEvent` supports `stock_received`, `stock_shipped`, and `order_committed` (Shopify) event types

### Queue-Backed Webhook Pipeline

- `src/services/webhook-queue.ts` — `enqueueWebhookEvent`, `claimNextBatch`, `markEventSucceeded`, `markEventFailed`
- `src/app/api/queue/process/route.ts` — Vercel Cron worker protected by `CRON_SECRET`; claims batch → adapter normalize → `processSyncEventsBatch` → mark succeeded/failed per event; exponential retry delay; dead-letters after `max_attempts`
- `src/app/api/webhooks/shiphero/route.ts` — thin: verify HMAC → enqueue → return `{ queued: true, eventId, verified: true }` in ~150 ms
- `src/app/api/webhooks/shopify/route.ts` — thin: verify HMAC → enqueue → return `{ queued: true, eventId, verified: true }` (queue-backed, migrated from inline sync)
- `src/app/api/queue/status/route.ts` — authenticated endpoint returning per-status counts + recent failures for the dashboard panel
- `src/app/api/health/route.ts` — unauthenticated liveness probe; queries DB and returns `{ ok, db, timestamp }`
- `vercel.json` — cron config: `/api/queue/process` every minute
- `.github/workflows/process-queue.yml` — GitHub Actions fallback cron (every 5 min) for queue worker
- `.github/workflows/keep-supabase-active.yml` — pings `/api/health` every 5 days to prevent Supabase free-tier pause

### Automated Coverage

- 28 Vitest unit tests across 4 test files — all passing
  - `tests/api/inventory-routes.test.ts` (3)
  - `tests/api/integrations-route.test.ts` (5)
  - `tests/api/webhooks-route.test.ts` (11) — both ShipHero and Shopify tests assert `enqueueWebhookEvent` is called; response is `{ queued: true }`
  - `tests/api/webhook-queue.test.ts` (9) — worker auth, empty queue, success, retry, dead-letter, no adapter, adapter throws
- 11 Playwright E2E tests against production (`https://microfill.vercel.app`)
  - `tests/e2e/public-pages.spec.ts` — title, login page, dashboard redirect, onboarding redirect
  - `tests/e2e/api-smoke.spec.ts` — webhook 400/401 responses, queue worker auth, integrations/inventory 401, health check, queue status 401, Shopify HEAD probe
- `tests/__mocks__/server-only.ts` stub so API route test files can be imported by Vitest
- `.github/workflows/route-validation.yml` — Vitest runs on every push and PR
- `.github/workflows/e2e-smoke.yml` — Playwright E2E runs against production on every push to main

### Deployment Setup

- `vercel.json` with cron job config
- `scripts/check-deploy-env.mjs` — validates all required env vars before deploy
- `npm run deploy:check` — runs the pre-deploy check
- `npm run supabase:link` — links local CLI to hosted project
- `npm run supabase:push` — pushes pending migrations to hosted Supabase
- `npm run test:e2e` — runs Playwright E2E suite against `http://localhost:3000`

---

## What Is Not Done

### Highest Priority Gaps

- No live ShipHero delivery validated against production credentials
- Fishbowl adapter `verifySignature` and `normalize` not yet implemented (stub is safe — always rejects)

### Secondary Gaps

- No alerting or anomaly-detection channels beyond audit trail and `webhook_events` status
- No automated reconciliation jobs for dropped/delayed webhooks
- Fishbowl adapter `verifySignature` and `normalize` not yet implemented (stub is safe — always rejects)

---

## Required Environment Variables

| Variable                        | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Hosted Supabase project URL                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service role key (server-side only)                      |
| `SHOPIFY_WEBHOOK_SECRET`        | Shopify HMAC signing secret                                       |
| `SHIPHERO_WEBHOOK_SECRET`       | ShipHero HMAC signing secret                                      |
| `CRON_SECRET`                   | Bearer token that Vercel sends when invoking `/api/queue/process` |

Run `npm run deploy:check` to verify all are set before deploying.

---

## Immediate Next Steps

1. **Apply migrations to hosted Supabase**

   ```
   npm run supabase:link   # enter project ref from Supabase dashboard
   npm run supabase:push
   ```

2. **Deploy to Vercel** — set the six env vars above, then `vercel --prod`

3. **Validate live ShipHero delivery** — rerun smoke test with a tunnel pointed at the Vercel preview URL

4. **Complete Fishbowl adapter** — fill in `verifySignature` and `normalize` once Fishbowl credentials are available

5. **Run Playwright E2E** — `npm run dev` in one terminal, `npm run test:e2e` in another

---

## Recommended Execution Order

1. Apply hosted Supabase migrations and deploy to Vercel
2. Confirm cron worker is firing (check Vercel Cron dashboard)
3. Validate live ShipHero delivery against a webhook-enabled sandbox or production account
4. Complete Fishbowl adapter implementation
5. Add Playwright E2E runs to CI alongside existing Vitest coverage
6. Revisit OAuth only if operator onboarding needs exceed email-based auth.

## Immediate Next Task

**Best next task:** validate live ShipHero delivery or add a second WMS adapter.

Why:

- The universal adapter architecture is now in place. Adding a new WMS (Fishbowl, NetSuite, Deposco, etc.) only requires: a type definition file, an adapter file implementing `WmsAdapter`, registration in the adapter registry, and a new webhook route. No changes to shared infrastructure are needed.
- The ShipHero route is now thin and adapter-driven. All 20 Vitest tests pass.
- The remaining gap is either live ShipHero delivery (requires provider credentials) or a second adapter implementation to prove the pattern works for a different WMS.

Resume checklist:

- If pursuing live ShipHero delivery: obtain provider credentials and run `npm run webhook:shiphero:live:prepare` then `npm run webhook:shiphero:live:smoke`.
- If pursuing a second adapter: create `src/types/<provider>.ts` + `src/services/wms-adapters/<provider>.ts`, register in `src/services/wms-adapters/index.ts`, and add a route at `src/app/api/webhooks/<provider>/route.ts`.
- Either path: add the new provider to `managedIntegrationProviders` in `src/types/integrations.ts` if it needs dashboard integration management.

## Open Decisions

### Integration Testing

- Use recorded payload fixtures only, or require live/sandbox Shopify and ShipHero testing during development?

### Scope Control

- Keep Fishbowl and NetSuite out of MVP until Shopify and ShipHero are stable.

## Known Risks

- ShipHero webhooks still exist before they are fully validated against production-like payloads
- The MVP ShipHero route remains synchronous, so timeouts or repeated provider retries are still possible under heavier load until queue-backed processing is added in version 2
- The planned ShipHero version 2 queue foundation has not been created yet, so retry/dead-letter architecture still exists only as a design note
- No dead-letter or retry queue means repeated failures can still drop operational events
- Cloudflare quick tunnels remain ephemeral, so live ShipHero smoke success only holds while the current tunnel hostname stays active
- Audit history is visible, but long-horizon analytics and automated reconciliation jobs are still missing
- Integration secrets/config can now be managed per tenant in the dashboard, route coverage exists, and tunnel smoke is verified, but live ShipHero delivery is still unverified without provider credentials
- Dashboard scale behavior is still unknown for large inventories

## Local Development Notes

- Hosted Supabase remains paused; local Docker-backed Supabase is the active development path.
- Local stack config: `supabase/config.toml`
- Local seed data: `supabase/seed.sql`
- Local auth email template: `supabase/templates/magic-link.html`
- Main local commands:
  - `npm run supabase:start`
  - `npm run supabase:stop`
  - `npm run supabase:reset`
  - `npm run supabase:env`
  - `npm run supabase:types`
  - `npm test`

## Current Live Shopify State

- Active development store: `microfill-2.myshopify.com`
- Current tunnel path: Cloudflare quick tunnel, not localtunnel
- Current tunnel URL during confirmed validation: `https://models-vat-patent-standing.trycloudflare.com`
- Local mapped variants:
  - `SKU-DEMO-BLUE` -> product `15287484154022`, variant `56390813515942`
  - `SKU-DEMO-RED` -> product `15287484252326`, variant `56390813876390`
- Real Shopify traffic has reached the route during this session
- The webhook crash on null `variant_id` is fixed and covered by Vitest
- Latest automated status: `npx vitest run` passed with 14 tests
- Latest confirmed live Shopify mutation:
  - `2026-04-18T08:58:40.066194+00:00` `SKU-DEMO-BLUE` `committed_quantity = 4 -> 5`
  - `2026-04-18T08:58:40.079556+00:00` `SKU-DEMO-RED` `committed_quantity = 8 -> 9`

## Working Definition Of MVP

The MVP is done when all of the following are true:

- Authenticated users can sign in, get assigned to a tenant, and reach the dashboard
- Shopify inbound events can be validated and applied locally
- ShipHero inbound events can be validated and applied locally
- Inventory mutations are auditable
- Operators can review and make key inventory adjustments from the dashboard
- Local development remains reproducible from migrations, seed data, and documented commands
