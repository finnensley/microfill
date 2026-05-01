# MicroFill: High-Concurrency Inventory Control Layer

By soloSoftwareDev LLC

MicroFill is a specialized Micro-SaaS designed to reduce "Shadow Inventory" and prevent oversells during high-traffic Shopify launches and other high-concurrency commerce events. Instead of relying on brittle read-modify-write synchronization, MicroFill is built around atomic SQL buffering so inventory commitments can be enforced at the database layer.

## Product Vision

MicroFill is intended to become a production-ready control layer for high-volume commerce operations that need tighter inventory correctness than standard middleware can offer. The end-state product is designed around four core capabilities:

- Atomic inventory reservation and reconciliation
- Tenant-isolated operations for multiple brands or storefronts
- Warehouse and storefront event ingestion from systems like ShipHero and Shopify
- Operator tooling for high-traffic launch management, including safety floors and flash mode

## Target Production Architecture

This section describes the intended end-state architecture, not only what is already finished in the current build.

- Framework: Next.js 16 with App Router, TypeScript, and Tailwind
- Database: PostgreSQL via Supabase with PL/pgSQL atomic functions and tenant-aware schema design
- Auth: Supabase Auth with email-based sign-in as the MVP production path; Shopify OAuth can be added later if onboarding needs expand
- Integration Layer: HMAC-verified webhook ingestion plus service wrappers for Shopify and ShipHero
- Operations Layer: inventory dashboard, audit trail, manual controls, flash mode, and reconciliation workflows
- Communications: Resend or equivalent transactional email/reporting channel for alerts and summaries

## Current Production Boundary

What is implemented and validated today:

- Local Docker-backed Supabase development with seeded tenant data
- Authenticated tenant-scoped dashboard access at `https://micro-fill.app`
- Operator controls for quantity, safety floors, flash mode, and reconciliation review
- **Queue-backed, asynchronous webhook processing** for both Shopify and ShipHero, with dead-letter handling and crash-resilient workers
- **Outbound inventory synchronization** to Shopify — confirmed working end-to-end, pushing available quantities calculated as `total - committed - safety_floor`
- A universal **WMS adapter architecture** that supports Shopify, ShipHero, and can be extended to other providers like Fishbowl
- Server-side paginated inventory APIs and corresponding UI controls in the dashboard
- Comprehensive Vitest and Playwright test suites integrated into CI/CD workflows
- Audit history, integration status tracking, and retry/recovery guidance for inbound flows

What is not yet production-ready:

- Live ShipHero provider delivery validation with production-issued credentials
- Reporting, alerting, anomaly detection, and transactional email delivery
- Fishbowl adapter implementation (safe stub in place — always rejects until implemented)

## Why MicroFill Exists

Traditional inventory middleware tends to fail at the exact moment it matters most: during fast, concurrent inventory changes across storefronts and warehouses. MicroFill reduces that failure mode by moving critical inventory reservation logic closer to the database and giving operators explicit controls when traffic or warehouse lag becomes operationally risky.

## Core System Design

### The Triple-Sync Fail-Safe

MicroFill solves the race-condition problem through three layers of protection:

1. **Atomic increments:** RPC-driven inventory updates modify `committed_quantity` directly in the database engine to avoid read-modify-write loss.
2. **Safety buffering:** a configurable safety floor hides a portion of stock from storefront availability to absorb API latency and concurrency spikes.
3. **Flash mode:** a manual operational control can pause outbound synchronization during extreme peaks, followed by controlled reconciliation.

### Webhook Architecture

All inbound webhooks from Shopify and ShipHero are handled asynchronously. Upon receipt, the webhook route verifies the HMAC signature, enqueues the raw event into the `webhook_events` database table, and immediately returns a `202 Accepted` response. This ensures that even during a traffic spike, webhook providers receive a fast response preventing timeouts and retries.

A separate worker, triggered by a Vercel Cron Job every minute (with a GitHub Actions fallback every 5 minutes), claims a batch of events using `SELECT FOR UPDATE SKIP LOCKED` to prevent race conditions between multiple worker instances. Each event is normalized through a provider-specific WMS adapter and processed. The system uses exponential backoff for retries and dead-letters events after repeated failures. A separate reconciliation job runs every 15 minutes to reset any events stuck in `processing` due to worker crashes.

### Data Model

- `inventory_items` — core inventory state, including `shopify_inventory_item_id` for outbound sync caching
- `webhook_events` — queue table for all inbound webhook payloads
- `integrations` — per-tenant credentials and config for Shopify and ShipHero
- `audit_logs` — field-level inventory mutation history
- `tenants`, `user_tenant_assignments` — multi-tenant access control

## Current Implementation Snapshot

- Local Docker-backed Supabase development workflow
- Queue-backed webhook pipeline using `webhook_events` and `SELECT FOR UPDATE SKIP LOCKED`
- Asynchronous webhook processing via Vercel Cron worker with retry and dead-letter logic
- Outbound inventory sync to Shopify confirmed working — available quantities for `SKU-DEMO-BLUE` and `SKU-DEMO-RED` are correctly set at location `82250760358`
- Universal WMS adapter architecture normalizing data from Shopify, ShipHero, and stub providers
- Email sign-in with magic-link and OTP via Supabase Auth, pointed at `https://micro-fill.app`
- Protected dashboard and onboarding flow with server-side tenant-aware data access
- Dashboard controls for inventory, integrations, audit history, and reconciliation
- Automated Vitest (28 tests) and Playwright (11 E2E tests) coverage integrated into CI/CD

Detailed execution status, current gaps, and next build priorities are tracked in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Repository Shape

```text
/src
├── app/api/health          # Unauthenticated liveness probe
├── app/api/integrations    # API for managing tenant integrations
├── app/api/inventory       # Inventory data API and Shopify sync endpoint
├── app/api/queue           # Webhook queue worker, reconciler, and status
├── app/api/webhooks        # Shopify and ShipHero webhook entry points
├── app/(auth)              # Auth routes and login UI
├── app/dashboard           # Protected dashboard route
├── app/onboarding          # Tenant assignment flow
├── components/ui           # Dashboard and shared UI
├── components/forms        # Login and onboarding forms
├── hooks                   # Client hooks such as inventory loading
├── lib                     # Browser, server, and SSR auth Supabase clients
├── services                # Core business logic for sync and queueing
├── services/wms-adapters   # Adapters for Shopify, ShipHero, Fishbowl, NetSuite
└── types                   # Strict TypeScript and generated Supabase types
```

## Local Development Setup

While the hosted Supabase project is paused, local Docker-backed Supabase is the default development workflow.

1. Install Docker Desktop and the Supabase CLI.
2. Install dependencies:

```bash
npm install
```

3. Start the local Supabase stack:

```bash
npm run supabase:start
```

4. Print the local environment values:

```bash
npm run supabase:env
```

5. Copy `.env.example` to `.env.local` and paste the generated `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` values.
6. Set `DEFAULT_TENANT_ID` if you want a suggested local tenant during onboarding.
7. Reset and seed the local database from migrations:

```bash
npm run supabase:reset
```

8. Regenerate typed database definitions after schema changes:

```bash
npm run supabase:types
```

9. Run the app:

```bash
npm run dev
```

10. Run the automated route tests:

```bash
npm test
```

11. Only use a tunnel for webhook testing against real Shopify or ShipHero callbacks. Day-to-day UI and database work should stay local.

### Local Port Map

- Supabase API: http://127.0.0.1:54323
- Supabase Studio: http://127.0.0.1:54324
- Mailpit: http://127.0.0.1:54325

## Recommended Development Loop

- Build UI, hooks, and database logic against the local Supabase stack.
- Use the seeded local data for dashboard and landing-page development.
- Regenerate `src/types/supabase.ts` after changing tables or functions.
- Test webhook handlers locally with saved payloads first.
- Run `npm test` after changes to dashboard API routes or webhook handlers.
- Replay the saved Shopify order fixture with `npm run webhook:replay:shopify`.
- Replay the saved ShipHero PO and shipment fixtures with `npm run webhook:replay:shiphero:po` and `npm run webhook:replay:shiphero:shipment`.
- Run the full ShipHero scenario suite (6 named scenarios with pass/fail assertions) with `npm run shiphero:simulate:scenarios`.
- Simulate a high-concurrency launch (hundreds of concurrent orders against limited stock) with `npm run shiphero:simulate:launch`. Accepts `--stock`, `--orders`, `--sku`, and `--concurrency` flags.
- Use a Cloudflare quick tunnel only when validating real third-party webhook delivery.

## Live Shopify Validation

Use this only when the app is already running locally and a public HTTPS tunnel is forwarding to `http://localhost:3000`.

1. Start the app locally:

```bash
npm run dev
```

2. Start a public HTTPS tunnel to `localhost:3000`:

```bash
cloudflared tunnel --url http://localhost:3000
```

3. Copy the generated public URL into `SHOPIFY_TUNNEL_URL` in `.env.local`.
4. Set or confirm the live-validation values in `.env.local`:
   `SHOPIFY_LIVE_SHOP_DOMAIN`, `SHOPIFY_LIVE_SHOP_ID`, `SHOPIFY_TUNNEL_URL`, and a non-empty `SHOPIFY_WEBHOOK_SECRET`.
5. Map the local validation SKUs to real Shopify product and variant IDs:
   `SHOPIFY_LIVE_PRODUCT_BLUE_ID`, `SHOPIFY_LIVE_VARIANT_BLUE_ID`, `SHOPIFY_LIVE_PRODUCT_RED_ID`, `SHOPIFY_LIVE_VARIANT_RED_ID`.
6. Prepare the tenant-scoped Shopify integration:

```bash
npm run webhook:shopify:live:prepare
```

7. Smoke-test the tunnel and HMAC secret:

```bash
npm run webhook:shopify:live:smoke
```

8. In Shopify admin, update the `orders/create` webhook to point at `https://your-tunnel-host/api/webhooks/shopify`.
9. Place a test order containing one of the mapped variants.
10. Verify the result:

```bash
npm run webhook:shopify:live:verify
```

### Current Shopify Validation State

As of April 30, 2026, both inbound and outbound Shopify flows are confirmed working end-to-end.

- **Inbound:** Live `orders/create` webhooks are received, enqueued, and processed, updating `committed_quantity` correctly.
- **Outbound:** Inventory sync to Shopify is confirmed. `SKU-DEMO-BLUE` (available: 41) and `SKU-DEMO-RED` (available: 104) are correctly reflected in Shopify at location `82250760358`.
- The custom app token is stored in the production integration record and `shopify_inventory_item_id` is cached for both SKUs.
- Active development store: `microfill-2.myshopify.com`
- Mapped variants:
  - `SKU-DEMO-BLUE` → product `15287484154022`, variant `56390813515942`
  - `SKU-DEMO-RED` → product `15287484252326`, variant `56390813876390`

## Live ShipHero Validation

Use this only when the app is already running locally and a public HTTPS tunnel is forwarding to `http://localhost:3000`.

1. Start the app locally and a tunnel:

```bash
npm run dev
cloudflared tunnel --url http://localhost:3000
```

2. Copy the generated public URL into `SHIPHERO_TUNNEL_URL` in `.env.local`.
3. Set `SHIPHERO_TUNNEL_URL`, `SHIPHERO_LIVE_ACCOUNT_ID`, and a non-empty `SHIPHERO_WEBHOOK_SECRET`.
4. Prepare the tenant-scoped ShipHero integration:

```bash
npm run webhook:shiphero:live:prepare
```

5. Smoke-test the tunnel:

```bash
npm run webhook:shiphero:live:smoke
```

6. In ShipHero, point the webhook destination at `https://your-tunnel-host/api/webhooks/shiphero`.
7. Trigger a live `PO Update` or `Shipment Update`.
8. Verify the result:

```bash
npm run webhook:shiphero:live:verify
```

### Current ShipHero Validation State

As of April 30, 2026, the ShipHero path is partially validated.

- Recorded `PO Update` and `Shipment Update` payload replays succeed through the asynchronous queue pipeline.
- The webhook route correctly verifies ShipHero HMAC signatures.
- Cloudflare tunnel smoke tests return `200`, confirming the production endpoint is reachable.
- A real provider-initiated ShipHero delivery is still pending production credentials.

**Local simulation tooling** is available while waiting for provider access:

- `npm run shiphero:simulate:scenarios` — runs 6 named scenarios (receive-stock, ship-order, partial-receipt, multi-sku, zero-quantity, unknown-sku) end-to-end through the queue pipeline, with pass/fail assertions on the resulting inventory state.
- `npm run shiphero:simulate:launch` — fires hundreds of concurrent Shipment Update webhooks against limited stock to validate atomic consistency and floor-protection behavior under oversell conditions. Configurable via `--stock`, `--orders`, `--sku`, and `--concurrency` flags.

## CI/CD and GitHub Actions

Five scheduled workflows run against production:

- **`route-validation.yml`** — Vitest unit tests on every push and PR
- **`e2e-smoke.yml`** — Playwright E2E tests against `https://micro-fill.app` on every push to `main`
- **`process-queue.yml`** — GitHub Actions fallback queue worker (every 5 minutes)
- **`reconcile-queue.yml`** — Resets events stuck in `processing` (every 15 minutes)
- **`keep-supabase-active.yml`** — Pings `/api/health` every 5 days to prevent Supabase free-tier pause

Required GitHub Actions secrets: `APP_URL` (set to `https://micro-fill.app`) and `CRON_SECRET`.

## Current Auth Flow

- `/login` supports email magic link and OTP
- Supabase Auth Site URL is set to `https://micro-fill.app`; redirect URLs include `https://micro-fill.app/**`, `https://microfill.vercel.app/**`, and `http://localhost:3000/**`
- Middleware protects `/dashboard` and `/onboarding`, redirecting to `/login` when no session is present
- `/onboarding` assigns a tenant to the current user when no assignment exists
- `/dashboard` includes tenant-scoped integration settings for Shopify and ShipHero

## Planned Scope Beyond The Current Build

- Full ShipHero live delivery validation with production credentials
- Fishbowl adapter implementation
- Reporting, alerting, and anomaly detection
- Transactional email delivery for operator alerts
- Production deployment hardening and integration credential storage

## MVP End State

The MVP will be considered complete when the system can:

- authenticate and tenant-scope operators reliably
- ingest and validate inbound Shopify events
- ingest and validate inbound ShipHero events
- apply auditable inventory mutations safely
- expose the essential operational controls needed during high-traffic launches
- remain reproducible in local development from migrations, seed data, and documented commands

## Legal & Licensing

Property of soloSoftwareDev LLC. All rights reserved. Unauthorized copying of the core atomic buffering implementation or project-specific business logic is prohibited.
