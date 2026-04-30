# MicroFill: High-Concurrency Inventory Control Layer

By soloSoftwareDev LLC

MicroFill is a specialized Micro-SaaS designed to reduce "Shadow Inventory" and prevent oversells during high-traffic Shopify launches and other high-concurrency commerce events. Instead of relying on brittle read-modify-write synchronization, MicroFill is being built around atomic SQL buffering so inventory commitments can be enforced at the database layer. The repository today represents a local-first MVP build toward that production target, not a fully production-hardened release.

## Product Vision

MicroFill is intended to become a production-ready control layer for high-volume commerce operations that need tighter inventory correctness than standard middleware can offer. The end-state product is designed around four core capabilities:

- Atomic inventory reservation and reconciliation
- Tenant-isolated operations for multiple brands or storefronts
- Warehouse and storefront event ingestion from systems like ShipHero and Shopify
- Operator tooling for high-traffic launch management, including safety floors and flash mode

## Target Production Architecture

This section describes the intended end-state architecture, not only what is already finished in the current local build.

- Framework: Next.js 16 with App Router, TypeScript, and Tailwind
- Database: PostgreSQL via Supabase with PL/pgSQL atomic functions and tenant-aware schema design
- Auth: Supabase Auth with email-based sign-in as the MVP production path; Shopify OAuth can be added later if onboarding needs expand
- Integration Layer: HMAC-verified webhook ingestion plus service wrappers for Shopify and ShipHero
- Operations Layer: inventory dashboard, audit trail, manual controls, flash mode, and reconciliation workflows
- Communications: Resend or equivalent transactional email/reporting channel for alerts and summaries

## Current Production Boundary

The current repository should be understood as a validated local MVP slice of the broader product vision above.

What is implemented and validated today:

- local Docker-backed Supabase development with seeded tenant data
- authenticated tenant-scoped dashboard access
- operator controls for quantity, safety floors, flash mode, and reconciliation review
- **Queue-backed, asynchronous webhook processing** for both Shopify and ShipHero, with dead-letter handling and crash-resilient workers.
- **Outbound inventory synchronization** to Shopify, which can be triggered manually or runs automatically after stock-received events.
- A universal **WMS adapter architecture** that supports Shopify, ShipHero, and can be extended to other providers like Fishbowl.
- Server-side paginated inventory APIs and corresponding UI controls in the dashboard.
- Comprehensive Vitest and Playwright test suites integrated into CI/CD workflows.
- audit history, integration status tracking, and retry/recovery guidance for inbound flows

What is explicitly not production-ready yet:

- The outbound Shopify sync is built and deployed, but requires a Shopify Admin API access token to be fully activated.
- real ShipHero provider delivery validation with production-issued credentials
- reporting, alerting, anomaly detection, and transactional email delivery
- browser-level end-to-end coverage and deployment hardening

## Why MicroFill Exists

Traditional inventory middleware tends to fail at the exact moment it matters most: during fast, concurrent inventory changes across storefronts and warehouses. MicroFill is designed to reduce that failure mode by moving critical inventory reservation logic closer to the database and giving operators explicit controls when traffic or warehouse lag becomes operationally risky.

## Core System Design

### The Triple-Sync Fail-Safe

MicroFill is designed to solve the race-condition problem through three layers of protection:

1. Atomic increments: RPC-driven inventory updates modify `committed_quantity` directly in the database engine to avoid read-modify-write loss.
2. Safety buffering: a configurable safety floor hides a portion of stock from storefront availability to absorb API latency and concurrency spikes.
3. Flash mode: a manual operational control can pause outbound synchronization during extreme peaks, followed by controlled reconciliation.

### Data Model Direction

The platform is built around:

- `inventory_items` as the core inventory state table
- tenant-scoped access and isolation
- atomic helper functions for available quantity and committed quantity changes
- supporting tables for onboarding, tenant assignment, and operational workflows

## Current Implementation Snapshot

The repository is not yet at the full production target above. Today, the local build already includes:

- Local Docker-backed Supabase development workflow
- A queue-backed webhook pipeline using a `webhook_events` table and `SELECT FOR UPDATE SKIP LOCKED` for safe concurrent processing.
- Asynchronous processing of all inbound webhooks via a Vercel Cron worker, with graceful retry and dead-letter logic.
- Outbound inventory synchronization to Shopify, pushing available quantity changes based on warehouse events.
- A universal WMS adapter architecture to normalize data from different providers (Shopify, ShipHero, etc.).
- Working email sign-in with both magic-link and manual OTP paths
- Protected dashboard and onboarding flow with server-side tenant-aware data access.
- Dashboard controls for inventory, integrations, audit history, and reconciliation.
- Automated Vitest and Playwright test coverage for API routes and E2E flows.
- Live Shopify delivery is confirmed, and ShipHero tunnel smoke tests are confirmed against the live webhook URL.

Detailed execution status, current gaps, and next build priorities are tracked in [PROJECT_STATUS.md](/Users/finnensley/solo-work/microfill/PROJECT_STATUS.md).

## Repository Shape

The repository is organized around these areas:

````text
/src
├── app/api/webhooks        # Shopify and ShipHero webhook entry points
├── app/(auth)              # Auth routes and login UI
├── app/dashboard           # Protected dashboard route
├── app/onboarding          # Tenant assignment flow
├── components/ui           # Dashboard and shared UI
├── components/forms        # Login and onboarding forms
├── hooks                   # Client hooks such as inventory loading
├── lib     health          # Unauthenticated liveness probe
├── app/api/integrations    # API for managing integrations
├── app/api/inventory       # API for inventory data and Shopify sync
├── app/api/queue           # Webhook queue processing and status APIs
├── app/api/webhooks        # Shopify and ShipHero webhook entry points
├── app/(auth)              # Auth routes and login UI
├── app/dashboard           # Protected dashboard route
├── app/onboarding          # Tenant assignment flow
├── components/ui           # Dashboard and shared UI
├── components/forms        # Login and onboarding forms
├── hooks                   # Client hooks such as inventory loading
├── lib                     # Browser, server, and SSR auth Supabase clients
├── services                # Core business logic for sync and queueing
├── services/wms-adapters   # Adapters for different WMS provid
1. Install Docker Desktop and the Supabase CLI.
2. Install dependencies:

```bash
npm install
````

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
- Use a Cloudflare quick tunnel only when validating real third-party webhook delivery.

## Live Shopify Validation

Use this only when the app is already running locally and a public HTTPS tunnel is forwarding to `http://localhost:3000`.

1. Start the app locally:

```bash
npm run dev
```

2. Start a public HTTPS tunnel to `localhost:3000`.

Current recommendation: use a Cloudflare quick tunnel. Localtunnel was workable for earlier replay tests but proved unstable for repeated live Shopify delivery.

```bash
cloudflared tunnel --url http://localhost:3000
```

3. Copy the generated public URL into `SHOPIFY_TUNNEL_URL` in `.env.local`.
4. Set or confirm the live-validation values in `.env.local`:
   `SHOPIFY_LIVE_SHOP_DOMAIN=microfill-2.myshopify.com`, `SHOPIFY_LIVE_SHOP_ID=microfill-2`, `SHOPIFY_TUNNEL_URL`, and a non-empty `SHOPIFY_WEBHOOK_SECRET`.
5. Map the local validation SKUs to real Shopify product and variant IDs from your development store:
   `SHOPIFY_LIVE_PRODUCT_BLUE_ID`, `SHOPIFY_LIVE_VARIANT_BLUE_ID`, `SHOPIFY_LIVE_PRODUCT_RED_ID`, and `SHOPIFY_LIVE_VARIANT_RED_ID`.
6. Prepare the tenant-scoped Shopify integration and print the exact webhook target plus seeded variant IDs:

```bash
npm run webhook:shopify:live:prepare
```

7. Smoke-test the public tunnel and HMAC secret before touching Shopify:

```bash
npm run webhook:shopify:live:smoke
```

This should return a `200` response from `/api/webhooks/shopify`. If it fails, fix the local app, tunnel, or shared secret before retrying Shopify admin deliveries.

8. In Shopify admin for `microfill-2.myshopify.com`, create or update the `orders/create` webhook so it points at `https://your-tunnel-host/api/webhooks/shopify` and uses the same secret as `SHOPIFY_WEBHOOK_SECRET`.
9. Place a test order containing one of the mapped Shopify variants printed by the prepare script.
10. Verify the result in the dashboard, then confirm database and audit-log changes with:

```bash
npm run webhook:shopify:live:verify
```

11. The verifier now also prints the tenant's Shopify integration state, including `last_synced_at` and `last_error`, so you can tell whether Shopify reached the webhook route even when no inventory rows changed.
12. If you need a narrower audit window after a resend, pass a timestamp filter such as `npm run webhook:shopify:live:verify -- --since=2026-04-18T18:00:00Z`.

The real-ID mapping matters because the local webhook handler matches incoming Shopify line items by `shopify_variant_id`. The seeded demo IDs are placeholders until you replace them with actual IDs from `microfill-2.myshopify.com`.

## Live ShipHero Validation

Use this only when the app is already running locally and a public HTTPS tunnel is forwarding to `http://localhost:3000`.

1. Start the app locally:

```bash
npm run dev
```

2. Start a public HTTPS tunnel to `localhost:3000`.

Current recommendation: use a Cloudflare quick tunnel for the same reason as Shopify.

```bash
cloudflared tunnel --url http://localhost:3000
```

3. Copy the generated public URL into `SHIPHERO_TUNNEL_URL` in `.env.local`.
4. Set or confirm the live-validation values in `.env.local`: `SHIPHERO_TUNNEL_URL`, `SHIPHERO_LIVE_ACCOUNT_ID`, and a non-empty `SHIPHERO_WEBHOOK_SECRET`.
5. Prepare the tenant-scoped ShipHero integration and print the exact webhook target plus tracked validation SKUs:

```bash
npm run webhook:shiphero:live:prepare
```

6. Smoke-test the public tunnel and HMAC secret before touching the live ShipHero source:

```bash
npm run webhook:shiphero:live:smoke
```

This should return a `200` response from `/api/webhooks/shiphero`. If it fails, fix the local app, tunnel, secret, or account ID mapping before retrying the live source.

7. In ShipHero or the sandbox source, create or update the webhook destination so it points at `https://your-tunnel-host/api/webhooks/shiphero` and uses the same secret as `SHIPHERO_WEBHOOK_SECRET`.
8. Confirm the provider sends the same account or warehouse identifier stored in `SHIPHERO_LIVE_ACCOUNT_ID`, or update the integration config to match what ShipHero actually sends in `x-shiphero-account-id`.
9. Trigger a live `PO Update` or `Shipment Update` for one of the tracked SKUs printed by the prepare script.
10. Verify the result in the dashboard, then confirm database and audit-log changes with:

```bash
npm run webhook:shiphero:live:verify
```

11. The verifier also prints the tenant's ShipHero integration state, including `last_synced_at` and `last_error`, so you can tell whether ShipHero reached the webhook route even when no inventory rows changed.
12. If you need a narrower audit window after a resend, pass a timestamp filter such as `npm run webhook:shiphero:live:verify -- --since=2026-04-27T18:00:00Z`.

Current verified state for this workflow:

- `npm run webhook:shiphero:live:prepare` succeeds against the seeded tenant integration.
- `npm run webhook:shiphero:live:smoke` returns `200` through the active Cloudflare tunnel.
- A real provider-initiated ShipHero delivery is still pending because production-issued credentials and account identifiers are not yet available.

## ShipHero MVP Design Note

ForWebhook Architecture

The webhook ingestion pipeline is designed for high-concurrency and resilience. All inbound webhooks from providers like Shopify and ShipHero are handled asynchronously.

Upon receipt, the webhook route's only jobs are to verify the HMAC signature and enqueue the raw event into a dedicated `webhook_events` database table. It then immediately returns a `202 Accepted` response to the provider. This ensures that even during a massive traffic spike, webhook providers receive a fast response, preventing timeouts and retries.

A separate, out-of-band worker, triggered by a Vercel Cron Job, processes the queue. It claims a batch of events using a `SELECT FOR UPDATE SKIP LOCKED` pattern to prevent race conditions between multiple worker instances. Each event is normalized through a provider-specific WMS adapter and then processed. The system includes exponential backoff for retries and moves events to a dead-letter state after multiple failures, which can be inspected from the dashboard. This architecture ensures that event processing is reliable and does not block the inbound ingestion of new events

As of April 18, 2026, live Shopify validation is confirmed for the current MVP path.

- The active development store is `microfill-2.myshopify.com`.
- The tunnel used during the confirmed live validation was `https://models-vat-patent-standing.trycloudflare.com`.
- The local demo SKUs are already remapped to real Shopify IDs:
  - `SKU-DEMO-BLUE` -> product `15287484154022`, variant `56390813515942`
  - `SKU-DEMO-RED` -> product `15287484252326`, variant `56390813876390`
- The Shopify webhook route was patched after live traffic exposed a case where `line_items[*].variant_id` can be `null`.
- Focused route validation currently passes for the webhook and dashboard API test slices used during live validation work.
- A real Shopify delivery was confirmed on April 18, 2026 and produced these local mutations:
  - `SKU-DEM30, 2026, the Shopify integration is validated for both inbound and outbound data flows.

- **Inbound:** Live Shopify order creation webhooks are successfully received, enqueued, and processed, resulting in correct `committed_quantity` updates.
- **Outbound:** The inventory sync logic to push available stock levels back to Shopify is implemented and deployed. This feature is pending activation via a Shopify Admin API access token.
- The active development store is `microfill-2.myshopify.com`.
- The webhook route has been hardened against edge cases discovered during live testing, such as `null` variant IDs.
- The live-validation workflow includes scripts to prepare, smoke-test, and verify the integration
- A real provider-initiated ShipHero delivery is still the remaining validation gap.

## Current Local Auth Flow

- `/login` s30, 2026, the ShipHero path is partially validated.

- Recorded `PO Update` and `Shipment Update` payloads are successfully ingested via the asynchronous queue pipeline.
- The webhook route correctly verifies ShipHero HMAC signatures.
- Live "smoke tests" through a public tunnel succeed, confirming the endpoint is reachable and can process signed requests.
- The integration correctly records sync status and errors for operator diagnosis.
- The final validation step—confirming delivery from a real, provider-initiated ShipHero webhook—is still pending production credentials
- `/dashboard` now includes tenant-scoped integration settings so operators can manage Shopify and ShipHero configuration without manual SQL edits.

## Planned Scope Beyond The Current Build

The intended project scope still includes:

- Full Shopify inbound and outbound inventory workflows
- Full ShipHero event handling and validation
- Audit logging and operational history
- Dashboard controls for manual adjustments, safety floors, and flash mode
- Reporting, alerting, and anomaly detection
- Production deployment hardening, testing, and integration credential storage

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
