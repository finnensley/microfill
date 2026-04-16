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
- Auth: Supabase Auth with production auth strategy to be finalized between email sign-in and Shopify OAuth-assisted flows
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
- Protected dashboard and onboarding flow
- Server-side tenant-aware inventory reads
- Seeded local inventory data and generated database types
- Tenant-scoped integration storage for Shopify and ShipHero configuration
- Recorded Shopify webhook replay tooling with database and audit-log verification
- Recorded ShipHero PO and shipment replay tooling with database and audit-log verification
- Protected dashboard controls for quantity, safety floor, flash mode, and inventory filtering
- Dashboard audit history with field-level change summaries for recent inventory mutations

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

10. Only use a tunnel for webhook testing against real Shopify or ShipHero callbacks. Day-to-day UI and database work should stay local.

### Local Port Map

- Supabase API: http://127.0.0.1:54323
- Supabase Studio: http://127.0.0.1:54324
- Mailpit: http://127.0.0.1:54325

## Recommended Development Loop

- Build UI, hooks, and database logic against the local Supabase stack.
- Use the seeded local data for dashboard and landing-page development.
- Regenerate `src/types/supabase.ts` after changing tables or functions.
- Test webhook handlers locally with saved payloads first.
- Replay the saved Shopify order fixture with `npm run webhook:replay:shopify`.
- Replay the saved ShipHero PO and shipment fixtures with `npm run webhook:replay:shiphero:po` and `npm run webhook:replay:shiphero:shipment`.
- Introduce ngrok or a similar tunnel only when validating real third-party webhook delivery.

## Current Local Auth Flow

- `/login` supports email sign-in for local development.
- Users can continue by clicking the magic link or by manually entering the one-time code from the same email.
- `/dashboard` is protected by middleware and redirects to `/login` when no session is present.
- `/onboarding` explicitly assigns a tenant to the current user when no assignment exists yet.
- Inventory reads resolve tenant access on the server using the authenticated user context and explicit tenant assignment records.
- Tenant choices come from the `tenants` table, not from inventory records.

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
