# MicroFill Project Status

**Last Updated:** April 30, 2026  
**Stage:** Outbound Shopify sync built + deployed; awaiting Shopify Admin API access token to activate  
**Owner:** soloSoftwareDev LLC

---

## Current Position

MicroFill now has a complete queue-backed webhook pipeline with crash resilience, outbound Shopify inventory sync, and server-side paginated inventory access. All verified WMS payloads are enqueued on receipt and processed asynchronously by a Vercel Cron worker. When a `stock_received` event is processed, the worker automatically pushes the updated available quantity to the Shopify REST API (best-effort, non-blocking). Operators can also trigger a full inventory sync manually from the dashboard's Shopify integration card. The inventory API supports server-side pagination (`page`, `pageSize`, `total`) and the dashboard renders pagination controls when results span multiple pages.

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
- 11 Playwright E2E tests against production (`https://microfill.vercel.app`)
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

---

## What Is Not Done

### Highest Priority Gaps

**Shopify outbound sync — needs access token (blocked)**

- All sync code is deployed. Location ID (`82250760358`) and shop domain (`microfill-2.myshopify.com`) are already configured in `.env.local`.
- Missing: Shopify Admin API access token (`shpat_...`) with `write_inventory` scope.
- How to get it: Shopify Admin → Settings → Apps and sales channels → Develop apps → click your app → API credentials tab → **Reveal token once** under "Admin API access token". If already dismissed, uninstall and reinstall the app to regenerate.
- Once you have it, add to `.env.local`: `SHOPIFY_OUTBOUND_ACCESS_TOKEN=shpat_...`
- Then apply to production (two options):
  - **Dashboard**: https://microfill.vercel.app/dashboard → Integrations → Shopify → paste token into **API key** field → Save → click **Sync inventory to Shopify**
  - **Script**: `NEXT_PUBLIC_SUPABASE_URL=https://czaxkduxoufxeaosuqoy.supabase.co SUPABASE_SERVICE_ROLE_KEY=<hosted key> npm run shopify:sync:apply`
- Verify with: `npm run shopify:sync:verify`

**No live ShipHero delivery validated**

- Run `npm run webhook:shiphero:live:prepare` then `npm run webhook:shiphero:live:smoke` once ShipHero credentials are available.

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

1. **Activate Shopify outbound sync** (resume here)
   - Get `shpat_...` token from Shopify Admin → Settings → Apps → Develop apps → your app → API credentials → Reveal token
   - Paste into dashboard API key field OR add to `.env.local` and run `npm run shopify:sync:apply`
   - Click **Sync inventory to Shopify** on the dashboard to verify
   - Run `npm run shopify:sync:verify` to confirm config and see item eligibility

2. **Validate live ShipHero delivery** — run `npm run webhook:shiphero:live:smoke` once ShipHero credentials are available

3. **Complete Fishbowl adapter** — fill in `verifySignature` and `normalize` in `src/services/wms-adapters/fishbowl.ts`

4. **Add alerting** — wire `webhook_events` dead-letter count into a Slack/email alert or Vercel log drain

## Open Decisions

### Integration Testing

- Use recorded payload fixtures only, or require live/sandbox Shopify and ShipHero testing during development?

### Scope Control

- Keep Fishbowl and NetSuite out of MVP until Shopify and ShipHero are stable.

## Known Risks

- Outbound Shopify sync is deployed but inactive until the access token is set — no inventory is being pushed to Shopify yet
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
