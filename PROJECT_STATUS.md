# MicroFill Project Status

**Last Updated:** April 18, 2026  
**Stage:** Local MVP build-out  
**Owner:** soloSoftwareDev LLC

---

## Current Position

MicroFill now runs locally against Docker-backed Supabase and has a working auth, onboarding, and dashboard baseline. The project is past setup and schema bootstrapping. The main work is now turning the local prototype into an operator-ready MVP with tested Shopify and ShipHero flows.

Live Shopify validation is now confirmed end-to-end: a real Shopify delivery reached the local route through the Cloudflare tunnel, matched the mapped store variants, and produced the expected tenant-scoped `committed_quantity` and `audit_logs` mutations locally. The main remaining integration risk is now live ShipHero delivery.

## What Works Right Now

### Local Development

- Next.js app runs locally with the Supabase local stack
- Local Supabase config, seed data, scripts, and env workflow are in place
- Local auth email template is customized for the current sign-in flow

### Database

- `inventory_items` schema supports atomic buffering, safety floors, flash mode, and tenant scoping
- Multi-tenant support exists with tenant-aware indexes and RLS-oriented design
- Core RPC functions exist for ShipHero receipt and shipment syncing
- Additional working tables exist for `leads`, `tenants`, and `user_tenant_assignments`
- `audit_logs` table and `inventory_items` audit trigger are now in place for insert, update, and delete traceability
- `integrations` table now exists for tenant-scoped Shopify and ShipHero credentials/configuration

### Auth And Access

- `/login` supports email sign-in
- Users can sign in via magic link or manual OTP code
- `/auth/callback` exchanges the magic-link code into a session
- Middleware protects `/dashboard`
- Authenticated users can sign out from `/dashboard` and `/onboarding`
- Users without tenant access are redirected to `/onboarding`
- `/api/tenant-assignment` stores the selected tenant assignment

### Dashboard And Data Access

- `/dashboard` renders for authenticated users
- Inventory reads go through protected server-side access at `/api/inventory`
- Seeded local inventory data displays in the dashboard
- Dashboard now supports operator updates for on-hand quantity, safety floor percent, and flash mode
- Dashboard now shows recent tenant-scoped audit history with field-level change summaries
- Dashboard now supports tenant-scoped integration management for Shopify and ShipHero
- Landing page lead capture writes into `leads`

### Automated Coverage

- Vitest route coverage now exists for dashboard APIs (`/api/inventory`, `/api/inventory/audit`, `/api/integrations`)
- Vitest route coverage now exists for Shopify and ShipHero webhook handlers

### Webhook Foundation

- Shopify and ShipHero webhook routes exist
- Shopify route includes baseline HMAC verification
- Shared inventory sync/service structure exists for incoming warehouse events
- Webhook handlers can now resolve tenant-scoped integration configuration with env fallback
- Recorded Shopify replay tooling now exists for local webhook validation
- Shopify live-validation helper now exists to sync tenant config and print tunnel/store setup details
- Shopify live verification helper now exists to print tracked SKU state and recent tenant-scoped audit entries after a live order
- Cloudflare tunnel delivery has been smoke-tested successfully against the local Shopify route
- Shopify webhook handling now skips malformed line items without `variant_id` instead of returning a 500
- Recorded ShipHero replay tooling now exists for PO receipt and shipment validation

## What Is Not Done

### Highest Priority Gaps

- ShipHero webhook flow is validated locally with recorded PO and shipment replays, but not yet against live ShipHero delivery
- No live third-party delivery validation exists yet for ShipHero

### Secondary Gaps

- No webhook retry/dead-letter path yet
- No browser or database-backed end-to-end suite yet
- No production deployment plan yet

## Current Build Priorities

### Priority 1: Make Inventory Changes Traceable

**Status:** Database-side audit foundation and dashboard audit history are implemented. Broader operator analytics are still pending.

**Goal:** Use the new audit foundation to support safer integration work and later dashboard history views.

Deliverables:

- [x] Create `audit_logs` table
- [x] Add DB trigger or function-based logging for inventory changes
- [x] Expose read-only audit history in the dashboard

Why this is first:

- It reduces risk while debugging webhook behavior
- It gives visibility into inventory mutations before real integrations are trusted

### Priority 2: Finish Shopify Inbound Flow

**Status:** Complete for the current MVP target. Recorded payload replay succeeds locally and a real Shopify delivery has now been confirmed to mutate the mapped local inventory rows with matching audit-log entries.

**Goal:** Accept a real Shopify event and push it through the local inventory path safely.

Deliverables:

- [x] Connect webhook payload handling to the existing inventory commit path
- [x] Validate signature handling with recorded payload replay
- [x] Add structured logging around webhook success/failure
- [x] Add local replay tooling and demo integration seed support
- [x] Add tunnel-ready live validation helper and runbook
- [x] Fix live-delivery crash caused by Shopify line items with null `variant_id`
- [x] Validate delivery from a live Shopify store or tunnel

Definition of done:

- A real or replayed Shopify webhook updates local inventory predictably
- The resulting state can be observed in the dashboard and database
- Live Shopify test or real-order delivery is confirmed against the mapped store variants, not only placeholder fixture IDs

### Priority 3: Finish ShipHero Inbound Flow

**Status:** Recorded PO and shipment payload replays now succeed locally and verify inventory plus audit-log side effects. Live ShipHero delivery is still pending.

**Goal:** Validate the warehouse-side sync path using the existing RPC foundation.

Deliverables:

- [x] Harden ShipHero webhook parsing and validation
- [x] Map recorded payload fields to the existing sync event shape
- [x] Validate both receiving and shipment flows against realistic local events
- [x] Add structured success logging around ShipHero replay results
- [ ] Add failure logging and an explicit retry strategy
- [ ] Validate delivery from a live ShipHero source or tunnel

Definition of done:

- Receiving and shipment payloads update inventory correctly without manual DB intervention

### Priority 4: Make The Dashboard Useful For Operators

**Status:** Core operator controls and recent audit history are now implemented locally. Broader reconciliation views are still pending.

**Goal:** Move from read-only proof of life to a usable operations screen.

Deliverables:

- [x] Manual quantity adjustment form
- [x] Safety floor display and edit path
- [x] Flash mode toggle
- [x] Search/filtering for inventory items
- [x] Recent audit history panel
- [ ] Reconciliation-focused summary/history UI

Definition of done:

- An authenticated tenant user can inspect and make controlled inventory changes from the UI

## Recommended Execution Order

1. Validate live ShipHero delivery against a tunnel or sandbox source.
2. Add a fuller reconciliation summary view for operators.
3. Harden webhook failure logging and retry strategy.
4. Revisit OAuth only if operator onboarding needs exceed email-based auth.

## Immediate Next Task

**Best next task:** validate live ShipHero delivery against a tunnel or sandbox source.

Why:

- Live Shopify delivery has now been confirmed against the mapped local variants with fresh `committed_quantity` and `audit_logs` mutations.
- Recorded ShipHero flows already pass locally, so live provider delivery is now the biggest unresolved integration risk.
- The operator surface and audit trail are already in place, which makes warehouse-side validation the clearest next milestone.

Resume checklist:

- Confirm the local app is running with `npm run dev`.
- Confirm the public tunnel URL used for live delivery is still current.
- Point the live ShipHero source or sandbox webhook at the active tunnel URL.
- Deliver a real ShipHero receiving or shipment event.
- Verify resulting `inventory_items` and `audit_logs` mutations with the existing replay and audit tooling.

## Open Decisions

### Integration Testing

- Use recorded payload fixtures only, or require live/sandbox Shopify and ShipHero testing during development?

### Scope Control

- Keep Fishbowl and NetSuite out of MVP until Shopify and ShipHero are stable.

## Known Risks

- ShipHero webhooks still exist before they are fully validated against production-like payloads
- No dead-letter or retry queue means repeated failures can still drop operational events
- Audit history is visible, but broader operator analytics and reconciliation views are still missing
- Integration secrets/config can now be managed per tenant in the dashboard, and route coverage exists, but live ShipHero delivery is still unverified
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
