# MicroFill: High-Concurrency Inventory Engine

By soloSoftwareDev LLC

MicroFill is a specialized Micro-SaaS designed to reduce "Shadow Inventory" and prevent oversells during high-traffic Shopify launches and other high-concurrency commerce events. Instead of relying on brittle read-modify-write synchronization, MicroFill is being built around atomic SQL buffering so inventory commitments can be enforced at the database layer.

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
- Working email sign-in with both magic-link and manual OTP paths
- Logout flow for authenticated dashboard and onboarding sessions
- Protected dashboard and onboarding flow
- Server-side tenant-aware inventory reads
- Seeded local inventory data and generated database types
- Tenant-scoped integration storage for Shopify and ShipHero configuration
- Recorded Shopify webhook replay tooling with database and audit-log verification
- Recorded ShipHero PO and shipment replay tooling with database and audit-log verification
- Protected dashboard controls for quantity, safety floor, flash mode, and inventory filtering
- Protected dashboard integration management for Shopify and ShipHero credentials, webhook secrets, and activation state
- Dashboard audit history with field-level change summaries for recent inventory mutations
- Automated Vitest route coverage for the dashboard APIs and webhook handlers
- Shopify webhook handling is hardened against null `variant_id` line items discovered during live-store testing

Detailed execution status, current gaps, and next build priorities are tracked in [PROJECT_STATUS.md](/Users/finnensley/solo-work/microfill/PROJECT_STATUS.md).

## Repository Shape

The repository is organized around these areas:

```text
/src
├── app/api/webhooks        # Shopify and ShipHero webhook entry points
├── app/(auth)              # Auth routes and login UI
├── app/dashboard           # Protected dashboard route
├── app/onboarding          # Tenant assignment flow
├── components/ui           # Dashboard and shared UI
├── components/forms        # Login and onboarding forms
├── hooks                   # Client hooks such as inventory loading
├── lib                     # Browser, server, and SSR auth Supabase clients
├── services                # Inventory sync and future integration wrappers
└── types                   # Strict TypeScript and generated Supabase types
```

## Local Development Setup

While the hosted Supabase project is paused, local Docker-backed Supabase is the default development workflow for this repository.

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
- Introduce ngrok or a similar tunnel only when validating real third-party webhook delivery.

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

### Current Shopify Validation State

As of April 18, 2026, live Shopify validation is confirmed for the current MVP path.

- The active development store is `microfill-2.myshopify.com`.
- The tunnel used during the confirmed live validation was `https://models-vat-patent-standing.trycloudflare.com`.
- The local demo SKUs are already remapped to real Shopify IDs:
  - `SKU-DEMO-BLUE` -> product `15287484154022`, variant `56390813515942`
  - `SKU-DEMO-RED` -> product `15287484252326`, variant `56390813876390`
- The Shopify webhook route was patched after live traffic exposed a case where `line_items[*].variant_id` can be `null`.
- Automated verification now passes with 14 Vitest tests, including a regression test for null `variant_id` line items.
- A real Shopify delivery was confirmed on April 18, 2026 and produced these local mutations:
  - `SKU-DEMO-BLUE`: `committed_quantity = 4 -> 5`
  - `SKU-DEMO-RED`: `committed_quantity = 8 -> 9`
- The live-validation workflow now includes `npm run webhook:shopify:live:verify` so the mapped SKUs and recent tenant-scoped audit entries can be checked without hand-written SQL.

If Shopify's admin-side "Send test" action produces no database change, inspect the delivery payload before assuming the route failed. In this session, synthetic test deliveries sometimes used placeholder or unmatched variant IDs, which correctly resulted in skipped line items instead of inventory mutations.

## Current Local Auth Flow

- `/login` supports email sign-in for local development.
- Email-based Supabase Auth is the chosen MVP auth strategy for the first production release.
- Users can continue by clicking the magic link or by manually entering the one-time code from the same email.
- `/dashboard` is protected by middleware and redirects to `/login` when no session is present.
- Authenticated users can sign out from `/dashboard` and `/onboarding`.
- `/onboarding` explicitly assigns a tenant to the current user when no assignment exists yet.
- Inventory reads resolve tenant access on the server using the authenticated user context and explicit tenant assignment records.
- Tenant choices come from the `tenants` table, not from inventory records.
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
