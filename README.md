MicroFill: High-Concurrency Inventory Engine
By soloSoftwareDev LLC

  MicroFill is a specialized Micro-SaaS designed to eliminate "Shadow Inventory" and prevent oversells during high-traffic Shopify launches ($1M+ events). Unlike traditional middleware, MicroFill utilizes Atomic SQL buffering to handle race conditions that break standard API-based sync tools.

- Core Architecture
  - Framework: Next.js 15 (App Router, TypeScript, Tailwind)

  - Database: PostgreSQL (Supabase) with PL/pgSQL Atomic Functions

  - Auth: Supabase Auth (OTP & OAuth)

  - Infrastructure: Edge Functions for HMAC-verified Shopify Webhooks

  - Communications: Resend (Transactional Alerts & Weekly Reports)

- Project Structure
  /src
   ├── app/api/webhooks  # HMAC-verified Shopify entry points
   ├── components/ui     # Atomic Shadcn components
   ├── hooks/            # useInventory (Real-time DB subscriptions)
   ├── lib/              # Supabase & Stripe singleton clients
   ├── services/         # Shopify Admin API wrappers
   └── types/            # Strict TypeScript inventory interfaces

- The "Triple-Sync" Fail-Safe

  MicroFill solves the Race Condition problem through three layers of protection:

  1. Atomic Increments: We use rpc calls to increment committed_quantity directly in the DB engine, preventing "Read-Modify-Write" data loss.

  2. Safety Buffering: A user-defined "Safety Floor" hides the last 5-10% of stock from Shopify to absorb API latency.

  3. Flash Mode: A manual toggle that pauses outgoing API updates during peak surges to let Shopify's native engine handle the "Heat," followed by a one-click reconciliation.

- Development Setup
  1. Environment: Copy .env.example to .env.local and add your SUPABASE_SERVICE_ROLE_KEY and SHOPIFY_WEBHOOK_SECRET.
  
  2. Database: Run the migrations in /supabase/migrations to set up the inventory_items table and the check_inventory_threshold trigger.

  3. Install: npm install

  4. Dev: npm run dev

- Legal & Licensing
Property of soloSoftwareDev LLC. All rights reserved.
Unauthorized copying of the "Atomic Buffering" logic is strictly prohibited.

