# MicroFill Project Status

**Last Updated:** April 30, 2026  
**Stage:** Shopify outbound sync confirmed working end-to-end; live ShipHero delivery is the remaining primary gap  
**Owner:** soloSoftwareDev LLC

---

## Current Position

MicroFill now has a complete queue-backed webhook pipeline with crash resilience, confirmed end-to-end outbound Shopify inventory sync, and server-side paginated inventory access. All verified WMS payloads are enqueued on receipt and processed asynchronously by a Vercel Cron worker. When a `stock_received` event is processed, the worker automatically pushes the updated available quantity to the Shopify REST API (best-effort, non-blocking). Operators can also trigger a full inventory sync manually from the dashboard's Shopify integration card. The inventory API supports server-side pagination (`page`, `pageSize`, `total`) and the dashboard renders pagination controls when results span multiple pages.

The Shopify custom app token has been created via the legacy custom app path in Shopify admin, applied to the production integration record, and confirmed working — available quantities for both demo SKUs are correctly reflected in Shopify. Supabase Auth Site URL is configured as `https://micro-fill.app` so magic links route correctly to production. GitHub Actions secrets (`APP_URL`, `CRON_SECRET`) are updated so the process-queue and reconcile-queue workflows run cleanly against production.

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
- Integration management UI for Shopify and ShipHero tenant credentials; Shopify card includes **Inventory Location ID** field and **Sync inventory to Shopify** button
- Dashboard surfaces ShipHero recovery guidance and exception-focused audit history filters
- Inventory grid paginates server-side (Next/Prev controls, page + total display)

### Outbound Shopify Inventory Sync

- `src/services/shopify-sync.ts` — `pushInventoryToShopify({ tenantId, sku? })` fetches and caches `shopify_inventory_item_id` per variant, then calls `POST /admin/api/2024-10/inventory_levels/set.json` with `available = max(0, total - committed - safety_floor)`. Non-blocking; errors are logged but never thrown.
- `src/app/api/inventory/shopify-sync/route.ts` — authenticated POST for manual full sync; returns `{ synced, skipped, errors }`
- `inventory-sync.ts` — calls `pushInventoryToShopify` (best-effort) after every successful `stock_received` event
- `supabase/migrations/20260430000100_add_shopify_inventory_item_id.sql` — adds `shopify_inventory_item_id TEXT` (nullable) to `inventory_items`
- **Confirmed working end-to-end as of April 30, 2026** — `SKU-DEMO-BLUE` (available: 41) and `SKU-DEMO-RED` (available: 104) are correctly set in Shopify at location `82250760358`. The `shopify_inventory_item_id` is cached for both SKUs in the production database (`54850109866150` and `54850111013030` respectively).

### Server-Side Paginated Inventory

- `src/app/api/inventory/route.ts` — GET accepts `?page=&pageSize=` (default 1/25, max pageSize 100); returns `{ items, page, pageSize, total }`
- `src/hooks/use-inventory.ts` — exposes `{ page, totalPages, total, goToPage }` alongside existing state

### Universal WMS Adapter Architecture

- `WmsAdapter` interface is the single integration contract — `hmacHeader`, `verifySignature()`, `normalize()`, `getExternalAccountId()`, `getEnvSecretKey()`
- `WmsProvider` union type (`"shopify" | "shiphero" | "fishbowl" | "netsuite"`) is the single source of truth
- `src/services/wms-adapters/shiphero.ts` — production-ready ShipHero adapter
- `src/services/wms-adapters/shopify.ts` — production-ready Shopify adapter; `normalize()` returns `order_committed` events keyed by variant ID
- `src/services/wms-adapters/fishbowl.ts` — Fishbowl stub (registered, safe stub that returns `false` from `verifySignature` until implemented)
- Adapter registry at `src/services/wms-adapters/index.ts`
- `InventoryEvent` supports `stock_received`, `stock_shipped`, and `order_committed` (Shopify) event types

### Queue-Backed Webhook Pipeline

- `src/services/webhook-queue.ts` — `enqueueWebhookEvent`, `claimNextBatch`, `markEventSucceeded`, `markEventFailed`, `writeQueueAuditLog`
- `src/app/api/queue/process/route.ts` — Vercel Cron worker protected by `CRON_SECRET`; claims batch → adapter normalize → `processSyncEventsBatch` → mark succeeded/failed per event; writes `audit_logs` row on success; exponential retry delay; dead-letters after `max_attempts`
- `src/app/api/queue/reconcile/route.ts` — POST protected by `CRON_SECRET`; finds events stuck in `processing` > 10 min and resets them to `pending` to survive worker crashes
- `src/app/api/webhooks/shiphero/route.ts` — thin: verify HMAC → enqueue → return `{ queued: true, eventId, verified: true }` in ~150 ms
- `src/app/api/webhooks/shopify/route.ts` — thin: verify HMAC → enqueue → return `{ queued: true, eventId, verified: true }` (queue-backed)
- `src/app/api/queue/status/route.ts` — authenticated endpoint returning per-status counts + recent failures for the dashboard panel
- `src/app/api/health/route.ts` — unauthenticated liveness probe; queries DB and returns `{ ok, db, timestamp }`
- `vercel.json` — cron config: `/api/queue/process` every minute
- `.github/workflows/process-queue.yml` — GitHub Actions fallback cron (every 5 min) for queue worker
- `.github/workflows/reconcile-queue.yml` — GitHub Actions cron (every 15 min) calling `/api/queue/reconcile` to reset stuck events
- `.github/workflows/keep-supabase-active.yml` — pings `/api/health` every 5 days to prevent Supabase free-tier pause

### Automated Coverage

- 28 Vitest unit tests across 4 test files — all passing
  - `tests/api/inventory-routes.test.ts` (3)
  - `tests/api/integrations-route.test.ts` (5)
  - `tests/api/webhooks-route.test.ts` (11) — both ShipHero and Shopify tests assert `enqueueWebhookEvent` is called; response is `{ queued: true }`
  - `tests/api/webhook-queue.test.ts` (9) — worker auth, empty queue, success, retry, dead-letter, no adapter, adapter throws
- 11 Playwright E2E tests against production (`https://micro-fill.app`)
  - `tests/e2e/public-pages.spec.ts` — title, login page, dashboard redirect, onboarding redirect
  - `tests/e2e/api-smoke.spec.ts` — webhook 400/401 responses, queue worker auth, integrations/inventory 401, health check, queue status 401, Shopify HEAD probe
- `tests/__mocks__/server-only.ts` stub so API route test files can be imported by Vitest
- `.github/workflows/route-validation.yml` — Vitest runs on every push and PR
- `.github/workflows/e2e-smoke.yml` — Playwright E2E runs against production on every push to main
- Dashboard queue health panel auto-refreshes every 30 seconds (no manual refresh required)

### Deployment Setup

- `vercel.json` with cron job config
- `scripts/check-deploy-env.mjs` — validates all required env vars before deploy
- `npm run deploy:check` — runs the pre-deploy check
- `npm run supabase:link` — links local CLI to hosted project
- `npm run supabase:push` — pushes pending migrations to hosted Supabase
- `npm run test:e2e` — runs Playwright E2E suite against `http://localhost:3000`

### ShipHero Local Simulation Tooling

Two scripts for validating the ShipHero pipeline locally without provider credentials:

- `scripts/simulate-shiphero-scenarios.mjs` (`npm run shiphero:simulate:scenarios`) — runs 6 named scenarios end-to-end through the queue pipeline, asserting the exact expected inventory delta after each one:
  - `receive-stock` — PO Update +7 units, asserts `total_quantity` delta
  - `ship-order` — Shipment Update -3 units, asserts `total_quantity` delta
  - `partial-receipt` — 5 of 30 ordered received, confirms only `quantity_received` is applied
  - `multi-sku` — two SKUs in one PO Update, both deltas asserted
  - `zero-quantity` — `quantity_received=0`, confirms inventory unchanged
  - `unknown-sku` — non-existent SKU, confirms graceful no-op not a queue error

- `scripts/simulate-shiphero-launch.mjs` (`npm run shiphero:simulate:launch`) — simulates a high-concurrency item launch: pre-stocks a SKU via PO Update, fires hundreds of concurrent Shipment Updates (configurable via `--stock`, `--orders`, `--sku`, `--concurrency`), drains the queue, and reports final inventory state. Surfaces floor-protection behavior: even when demand exceeds stock, `available-for-sale = max(0, total - committed - floor)` ensures Shopify never sees a negative number.

---

## What Is Not Done

### Highest Priority Gaps

**No live ShipHero delivery validated**

- The pipeline is fully exercised locally via `npm run shiphero:simulate:scenarios` and `npm run shiphero:simulate:launch`.
- Live provider delivery still requires real `SHIPHERO_LIVE_ACCOUNT_ID` and `SHIPHERO_WEBHOOK_SECRET` from ShipHero.
- Once credentials are available: `npm run webhook:shiphero:live:prepare` then `npm run webhook:shiphero:live:smoke`.

### Secondary Gaps

- No alerting or anomaly-detection channels beyond audit trail and `webhook_events` status
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

1. **Validate live ShipHero delivery** — local simulation (`npm run shiphero:simulate:scenarios` and `npm run shiphero:simulate:launch`) fully exercises the pipeline. Once provider credentials arrive, run `npm run webhook:shiphero:live:prepare` and `npm run webhook:shiphero:live:smoke`, then trigger a real webhook from ShipHero.

2. **Complete Fishbowl adapter** — fill in `verifySignature` and `normalize` in `src/services/wms-adapters/fishbowl.ts`

3. **Add alerting** — wire `webhook_events` dead-letter count into a Slack/email alert or Vercel log drain

## Open Decisions

### Integration Testing

- Recorded payload fixtures and local simulation scripts (`shiphero:simulate:scenarios`, `shiphero:simulate:launch`) cover the ShipHero pipeline locally. Live/sandbox testing with provider credentials is still needed for final sign-off.

### Scope Control

- Keep Fishbowl and NetSuite out of MVP until Shopify and ShipHero are stable.

## Known Risks

- Live ShipHero delivery is still unverified without provider credentials
- Cloudflare tunnels are ephemeral; live smoke tests only hold for the current tunnel hostname
- No alerting on dead-lettered `webhook_events`; failures are visible in the dashboard queue panel but not actively surfaced
- Dashboard inventory pagination is server-side but search/filter is still client-side (filters the current page only, not all pages)

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
- Production URL: `https://micro-fill.app`
- Supabase Auth Site URL: `https://micro-fill.app` (magic links route correctly to production)
- GitHub Actions `APP_URL` secret: `https://micro-fill.app`
- Outbound sync confirmed working at location `82250760358`
- Playwright `webServer` block disabled in CI — E2E tests run directly against production
- Mapped variants (production database):
  - `SKU-DEMO-BLUE` → product `15287484154022`, variant `56390813515942`, inventory_item `54850109866150` (available: 41)
  - `SKU-DEMO-RED` → product `15287484252326`, variant `56390813876390`, inventory_item `54850111013030` (available: 104)
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
