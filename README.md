MicroFill: High-Concurrency Inventory Engine
By soloSoftwareDev LLC

MicroFill is a specialized Micro-SaaS designed to eliminate "Shadow Inventory" and prevent oversells during high-traffic Shopify launches ($1M+ events). Unlike traditional middleware, MicroFill utilizes Atomic SQL buffering to handle race conditions that break standard API-based sync tools.

- Core Architecture
  - Framework: Next.js 16 (App Router, TypeScript, Tailwind)

  - Database: PostgreSQL (Supabase) with PL/pgSQL Atomic Functions

  - Auth: Supabase Auth (OTP & OAuth)

  - Infrastructure: Edge Functions for HMAC-verified Shopify Webhooks

  - Communications: Resend (Transactional Alerts & Weekly Reports)

- Project Structure
  /src
  ├── app/api/webhooks # HMAC-verified Shopify entry points
  ├── components/ui # Atomic Shadcn components
  ├── hooks/ # useInventory (Real-time DB subscriptions)
  ├── lib/ # Supabase & Stripe singleton clients
  ├── services/ # Shopify Admin API wrappers
  └── types/ # Strict TypeScript inventory interfaces

- The "Triple-Sync" Fail-Safe

  MicroFill solves the Race Condition problem through three layers of protection:
  1. Atomic Increments: We use rpc calls to increment committed_quantity directly in the DB engine, preventing "Read-Modify-Write" data loss.

  2. Safety Buffering: A user-defined "Safety Floor" hides the last 5-10% of stock from Shopify to absorb API latency.

  3. Flash Mode: A manual toggle that pauses outgoing API updates during peak surges to let Shopify's native engine handle the "Heat," followed by a one-click reconciliation.

- Development Setup
  1. Install Docker Desktop and the Supabase CLI.

  2. Install dependencies: npm install

  3. Start the local Supabase stack: npm run supabase:start

  4. Print the local environment values: npm run supabase:env

  5. Copy .env.example to .env.local and paste the generated NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY values.

  6. Reset and seed the local database from migrations: npm run supabase:reset

  6a. Regenerate typed database definitions after schema changes: npm run supabase:types
  7. Run the app: npm run dev

  8. Only use a tunnel for webhook testing against real Shopify or ShipHero callbacks. Day-to-day UI and database work should stay local.

  While the hosted Supabase project is paused, local Docker-backed Supabase is the default development workflow for this repository.

  Local port map for this repo:
  - Supabase API: http://127.0.0.1:54323
  - Supabase Studio: http://127.0.0.1:54324
  - Inbucket: http://127.0.0.1:54325

- Recommended Development Loop
  - Build UI, hooks, and database logic against the local Supabase stack.
  - Use the seeded local data for normal dashboard and landing-page development.
  - Regenerate `src/types/supabase.ts` after adding or changing tables/functions.
  - Test webhook handlers locally with saved payloads first.
  - Introduce ngrok or a similar tunnel only when validating live third-party webhook delivery.

- Local Auth Flow
  - `/login` uses Supabase email OTP for local auth testing.
  - `/dashboard` is protected by middleware and redirects to `/login` when no session is present.

- Legal & Licensing
  Property of soloSoftwareDev LLC. All rights reserved.
  Unauthorized copying of the "Atomic Buffering" logic is strictly prohibited.
