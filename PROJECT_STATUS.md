# MicroFill Project Status & Roadmap

**Last Updated:** April 15, 2026  
**Project Stage:** MVP Development (Early Implementation Phase)  
**Owner:** soloSoftwareDev LLC

---

## Executive Summary

MicroFill is a specialized Micro-SaaS designed to solve "Shadow Inventory" problems during high-traffic Shopify launches ($1M+ events). The project aims to provide atomic-level inventory synchronization between micro-warehouses and Shopify storefronts using PostgreSQL's atomic buffering to prevent race conditions that break traditional API-based sync tools.

**Core Innovation:** Triple-Sync Fail-Safe architecture:

1. **Atomic Increments** - SQL-level atomic updates prevent Read-Modify-Write data loss
2. **Safety Buffering** - Hides 5-10% of stock to absorb API latency during peak surges
3. **Flash Mode** - Manual toggle to pause API updates during extreme peaks, then one-click reconciliation

---

## Current Implementation Status

### ✅ Completed

#### Infrastructure & Setup

- [x] Next.js 16 project initialized (App Router, TypeScript, Tailwind)
- [x] Supabase integration configured
- [x] Environment variables structure defined
- [x] ESLint and build pipeline configured
- [x] Basic TailwindCSS theming (slate-900 dark theme)
- [x] Local Supabase Docker workflow documented for active development while hosted Supabase is paused

#### Database Schema

- [x] **Core Inventory Table** - `inventory_items` with atomic buffering fields:
  - `committed_quantity` (atomic increment support)
  - `safety_floor_quantity` (auto-calculated buffering)
  - `flash_mode_enabled` (manual override during peaks)
  - `shopify_variant_id` and `shopify_product_id` (Shopify mapping)
  - `sku` (cross-system identifier for multi-WMS)

- [x] **Multi-Tenancy Support** - Shopify shop isolation:
  - `tenant_id` column on `inventory_items`
  - Row-Level Security (RLS) policies enforced at DB level
  - Composite indexes for fast tenant-scoped lookups: `(tenant_id, shopify_variant_id)`, `(tenant_id, sku)`

- [x] **Atomic Functions** Created:
  - `get_available_quantity()` - Calculates available QTY accounting for atomic buffering + safety floor
  - `increment_committed_quantity()` - Atomically updates committed quantity (prevents race conditions)
  - `update_safety_floor()` - Auto-recalculates safety floor when total quantity changes
  - `update_inventory_timestamp()` - Maintains audit trail timestamps

- [x] **Database Indexes** - Performance optimized for:
  - `idx_inventory_tenant_variant` - Multi-tenant variant lookups
  - `idx_inventory_tenant_sku` - Multi-tenant SKU lookups
  - `idx_inventory_tenant` - Tenant-wide queries
  - `idx_inventory_shopify_product_id` - Shopify product fast lookups
  - `idx_inventory_updated_at` - Chronological queries

#### Backend/Webhook Structure

- [x] **Webhook Routing** - Established `/api/webhooks/shopify/` and `/api/webhooks/shiphero/` endpoints
- [x] **Event Normalizer** - Created `InventoryEvent` interface for multi-WMS support
- [x] **Core Sync Logic** - `processSyncEvent()` function handles:
  - **stock_received** - Increments `total_quantity`
  - **stock_shipped** - Decrements `total_quantity`
  - Multi-source tracking (Shopify, ShipHero, Fishbowl, NetSuite)
  - Tenant isolation enforcement

- [x] **RPC Wrappers Created** - Supabase RPC calls for:
  - `sync_shiphero_receiving()` - Stock receipt from ShipHero/warehouse
  - `sync_shiphero_shipment()` - Stock shipment tracking
  - Tenant-aware isolation on all RPC calls

#### Frontend

- [x] **Landing Page** - Basic homepage with email capture form:
  - Dark theme (slate-900 background, green-400 accent)
  - Hero messaging about Shadow Inventory elimination
  - "Early Access" email collection flowing into `leads` table
  - Client-side form with Supabase integration

- [x] **Project Structure** - Organized component hierarchy:
  - `/components/ui/` - Atomic UI components (ready for shadcn/ui integration)
  - `/components/forms/` - Complex form components (folder exists, awaiting forms)
  - `/components/shared/` - Navigation, sidebars, footers
  - `/lib/` - Supabase client singleton
  - `/services/` - Business logic wrappers (inventory-sync.ts)
  - `/types/` - TypeScript definitions for inventory and ShipHero

#### Authentication

- [ ] **Supabase Auth** - Infrastructure in place (`(auth)` route group exists)
  - Awaiting implementation of OTP and OAuth flows

### 🚧 In Progress / Partially Complete

- [x] Database schema (complete but needs audit logging table)
- [~] Shopify webhook HMAC verification - basic verification exists in the route handler, but still needs end-to-end testing and hardening
- [ ] ShipHero webhook handler - skeleton in place
- [ ] Dashboard UI - folder structure exists, needs implementation
- [x] RPC functions are present in migrations, but still need validation against real webhook payloads

### ❌ Not Started

- [ ] **Complete Authentication Flow**
  - OTP signup/login in `(auth)` routes
  - OAuth (Shopify or Supabase) flow
  - Session persistence
  - Protected routes (auth middleware)

- [ ] **Audit Logging System**
  - `audit_logs` table creation
  - Postgres trigger to auto-log all inventory changes
  - Audit trail UI for compliance

- [ ] **Shopify Integration**
  - HMAC verification in webhook handlers
  - Shopify Admin API wrapper for product/variant lookups
  - Store/shop context management
  - Scope negotiation and API key management

- [ ] **ShipHero Integration**
  - Full webhook handler implementation
  - ShipHero API wrapper for receiving/shipment data
  - Error handling and retry logic

- [ ] **Dashboard MVP**
  - Real-time inventory view (using Supabase subscriptions)
  - Manual stock adjustment forms
  - Safety floor percentage adjustment UI
  - Flash Mode toggle and reconciliation UI
  - SKU search and filtering

- [ ] **Mobile Scanner Component**
  - React hook for barcode scanning: `useInventory()`
  - Scanner UI component
  - Real-time sync feedback

- [ ] **Analytics & Reporting**
  - Weekly sync reports via Resend email service
  - Oversell prevention metrics
  - API latency analysis dashboard
  - Alert system for anomalies

- [ ] **Testing Infrastructure**
  - Unit tests for sync logic
  - Integration tests for webhook handlers
  - E2E tests for full sync flow
  - Test environment with ShipHero/Shopify test stores

- [ ] **Deployment & DevOps**
  - Production environment variables
  - CI/CD pipeline
  - Database backup strategy
  - Environment parity (dev/staging/prod)

- [ ] **Security Hardening**
  - API key encryption in database
  - Rate limiting on webhooks
  - CSP headers and security middleware
  - Secrets management

- [ ] **Documentation**
  - API integration guide for Shopify/ShipHero
  - Setup instructions for new tenants
  - Architecture documentation
  - Deployment runbook

---

## Working List: Next Steps to Move Forward

### Phase 1: Foundation (Current)

**Goal:** Establish working prototype with real webhook integration

#### P1.1 Database Completeness

- [x] Create `sync_shiphero_receiving()` RPC function in migrations
- [x] Create `sync_shiphero_shipment()` RPC function in migrations
- [ ] Add `audit_logs` table with triggers for all inventory changes
- [ ] Add `integrations` table to store encrypted Shopify/ShipHero credentials
- [ ] Create indexes on `audit_logs(inventory_id)` and `audit_logs(tenant_id, timestamp)`

**Effort:** 2-3 hours  
**Dependencies:** None  
**Blocks:** Shopify/ShipHero integration

#### P1.2 Shopify Webhook Implementation

- [x] Implement baseline HMAC-256 signature verification in `/api/webhooks/shopify/route.ts`
- [ ] Create Shopify API wrapper service (`src/services/shopify-api.ts`) with:
  - Product variant lookup by SKU
  - Inventory level updates
  - Error handling and retry logic
- [ ] Connect incoming Shopify orders/inventory changes to `processSyncEvent()`
- [ ] Test with Postman or ngrok + real Shopify store
- [ ] Add logging for webhook health monitoring

**Effort:** 4-5 hours  
**Dependencies:** P1.1 (RPC functions)  
**Blocks:** End-to-end testing

#### P1.3 Authentication MVP

- [ ] Implement Supabase OTP signup/login flow in `(auth)` routes
- [ ] Create auth context/provider for session management
- [ ] Add protected routes pattern (middleware for `/dashboard`)
- [ ] Create logout functionality
- [ ] Test with real Supabase project

**Effort:** 3-4 hours  
**Dependencies:** Supabase project configured  
**Blocks:** Dashboard development, testing

#### P1.4 Dashboard Skeleton

- [ ] Create basic dashboard layout in `src/app/dashboard/page.tsx`
- [ ] Implement real-time inventory list view using Supabase subscriptions
- [ ] Add manual quantity adjustment form
- [ ] Display safety floor info and flash mode toggle
- [ ] Add basic error handling

**Effort:** 5-6 hours  
**Dependencies:** P1.3 (auth), P1.1 (RPC functions)  
**Blocks:** End-to-end testing

**Estimated Phase 1 Timeline:** 2-3 weeks (concurrent work on P1.2 and P1.3)

---

### Phase 2: Integration & Testing

**Goal:** Production-ready webhook handlers and real data flow

#### P2.1 ShipHero Integration

- [ ] Implement ShipHero webhook handler in `/api/webhooks/shiphero/route.ts`
- [ ] Create ShipHero API wrapper (`src/services/shiphero-api.ts`)
- [ ] Test with ShipHero sandbox or real account
- [ ] Implement error handling and dead-letter queue for failed syncs

**Effort:** 4-5 hours  
**Dependencies:** P1.1, P1.2 (template)  
**Blocks:** Multi-WMS testing

#### P2.2 Testing Environment Setup

- [ ] Determine testing strategy: ShipHero sandbox vs. local test data
- [ ] Create test Shopify store and ShipHero account (if needed)
- [ ] Build seed scripts for test inventory data
- [ ] Document testing procedures

**Effort:** 2-3 hours  
**Dependencies:** None (can parallel with P2.1)  
**Blocks:** Integration testing

#### P2.3 Audit Logging UI

- [ ] Display audit logs in dashboard (read-only table)
- [ ] Add filters by action type, date range, changed_by
- [ ] Performance optimization for large audit log tables
- [ ] Export audit logs to CSV

**Effort:** 3-4 hours  
**Dependencies:** P1.4 (dashboard exists)  
**Blocks:** Compliance/production readiness

**Estimated Phase 2 Timeline:** 2-3 weeks

---

### Phase 3: Enhanced Features

**Goal:** Production optimization and advanced features

#### P3.1 Real-time Sync Reporting

- [ ] Implement weekly email reports via Resend
- [ ] Add dashboard charts for sync metrics
- [ ] Create alert system for oversell attempts/anomalies
- [ ] Metrics: API latency, sync success rate, peak concurrency

**Effort:** 4-5 hours  
**Dependencies:** P1.4 (dashboard exists)  
**Blocks:** None

#### P3.2 Multi-Tenant Admin Panel

- [ ] Tenant management UI (create/delete/manage shops)
- [ ] Per-tenant safety floor configuration
- [ ] Per-tenant API key management (encrypted storage)
- [ ] Tenant usage metrics and billing info

**Effort:** 5-6 hours  
**Dependencies:** P1.3 (auth)  
**Blocks:** Multi-customer go-to-market

#### P3.3 Performance & Security Hardening

- [ ] Add rate limiting to webhooks
- [ ] Implement database query performance monitoring
- [ ] Security audit of RLS policies
- [ ] API key encryption in `integrations` table
- [ ] CSP headers and security middleware

**Effort:** 4-5 hours  
**Dependencies:** None (can parallel)  
**Blocks:** Production deployment

**Estimated Phase 3 Timeline:** 2-3 weeks

---

### Phase 4: Go-to-Market

**Goal:** Landing page, documentation, and customer onboarding

#### P4.1 Product Documentation

- [ ] API integration guide for Shopify
- [ ] API integration guide for ShipHero
- [ ] Setup instructions for Supabase
- [ ] Troubleshooting guide

**Effort:** 4-5 hours  
**Dependencies:** P2.1 (all integrations complete)  
**Blocks:** Customer onboarding

#### P4.2 Landing Page Refinement

- [ ] Update hero messaging with product benefits
- [ ] Add use case sections (high-traffic launches, 3PL inventory, etc.)
- [ ] Create product demo video or interactive walkthrough
- [ ] Refine email capture flow

**Effort:** 3-4 hours  
**Dependencies:** None  
**Blocks:** Customer acquisition

#### P4.3 Customer Onboarding Flow

- [ ] Create guided setup wizard for new tenants
- [ ] API key generation and secure storage
- [ ] Webhook URL configuration for Shopify/ShipHero
- [ ] Test sync walkthrough

**Effort:** 4-5 hours  
**Dependencies:** P3.2 (tenant admin)  
**Blocks:** First customers

**Estimated Phase 4 Timeline:** 2-3 weeks

---

## Open Questions & Decisions Needed

1. **Authentication Strategy**
   - Use Supabase OTP + Shopify OAuth, or Supabase alone?
   - Impact: Customer identity verification and onboarding flow

2. **Testing Infrastructure**
   - Do we need live ShipHero account to develop, or can we mock?
   - Options: Sandbox environment, local database mocks, or real integration?
   - Impact: Development velocity and integration complexity

3. **Domain & Branding**
   - Use `microfill` subdomain or existing `solosoftwaredev` domain?
   - Impact: Customer perception and future product line expansion

4. **3PL Partnerships**
   - Should we proactively reach out to 3PLs (ShipBob, Barrettecs)?
   - If yes: Who owns the sales/integration relationship? What's the value prop?
   - Impact: Go-to-market and revenue model

5. **Historical WMS Support**
   - Should we add integrations for Fishbowl/NetSuite now or later?
   - Fishbowl is common in micro-fulfillment
   - Impact: MVP scope and time-to-market

---

## Success Metrics (Interim)

- [ ] End-to-end sync: Shopify order → Database → Real-time UI update (< 2 seconds)
- [ ] Zero oversells during synthetic high-concurrency test (1000+ concurrent orders)
- [ ] HMAC webhook verification preventing spoofed requests
- [ ] Audit trail shows 100% of inventory changes (no missing logs)
- [ ] Multi-tenant isolation enforced at database level
- [ ] All RPC functions return correct atomic increments
- [ ] Dashboard loads with < 1 second for 10K+ inventory items

---

## Tech Debt & Known Issues

- [ ] Validate the existing `sync_shiphero_receiving()` and `sync_shiphero_shipment()` RPC functions against real ShipHero payloads
- [ ] Add comprehensive error handling in webhook handlers (currently minimal)
- [ ] No dead-letter queue for failed syncs (will lose data on repeat failures)
- [ ] Dashboard performance not tested at scale (10K+ items)
- [ ] No caching strategy for frequently accessed inventory data

---

## Local Development Note

- Hosted Supabase is currently paused, so active development should use the local Docker-backed Supabase stack.
- Local stack configuration lives in `supabase/config.toml` and seeded data lives in `supabase/seed.sql`.
- Use `npm run supabase:start` to boot the stack, `npm run supabase:env` to retrieve local keys, and `npm run supabase:reset` to rebuild the local database from migrations and seed data.

---

## Resources & References

- **Shopify Webhook Docs:** https://shopify.dev/docs/apps/webhooks
- **Supabase RPC:** https://supabase.com/docs/guides/database/functions
- **Row-Level Security:** https://supabase.com/docs/guides/auth/row-level-security
- **Next.js API Routes:** https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- **PostgreSQL Triggers:** https://www.postgresql.org/docs/current/sql-createtrigger.html

---

## Notes

- This project prioritizes **correctness over speed** — atomic buffers and RLS are non-negotiable
- All webhook handlers must verify HMAC signatures to prevent spoofing
- Multi-tenancy is baked into the schema from day one (no refactoring later)
- Safety floor and flash mode are key differentiators vs. traditional middleware
