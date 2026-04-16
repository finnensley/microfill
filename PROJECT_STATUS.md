# MicroFill Project Status

**Last Updated:** April 16, 2026  
**Stage:** Local MVP build-out  
**Owner:** soloSoftwareDev LLC

---

## Current Position

MicroFill now runs locally against Docker-backed Supabase and has a working auth, onboarding, and dashboard baseline. The project is past setup and schema bootstrapping. The main work is now turning the local prototype into an operator-ready MVP with tested Shopify and ShipHero flows.

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
- Users without tenant access are redirected to `/onboarding`
- `/api/tenant-assignment` stores the selected tenant assignment

### Dashboard And Data Access

- `/dashboard` renders for authenticated users
- Inventory reads go through protected server-side access at `/api/inventory`
- Seeded local inventory data displays in the dashboard
- Landing page lead capture writes into `leads`

### Webhook Foundation

- Shopify and ShipHero webhook routes exist
- Shopify route includes baseline HMAC verification
- Shared inventory sync/service structure exists for incoming warehouse events
- Webhook handlers can now resolve tenant-scoped integration configuration with env fallback
- Recorded Shopify replay tooling now exists for local webhook validation

## What Is Not Done

### Highest Priority Gaps

- Shopify webhook flow is validated locally with recorded payload replay, but not yet against live Shopify delivery
- ShipHero webhook flow is not validated against real payloads
- Dashboard is read-only and still missing operator controls
- Audit history is not exposed in the dashboard yet
- Integration management UI does not exist yet

### Secondary Gaps

- No logout flow yet
- No final production auth decision yet
- No webhook retry/dead-letter path yet
- No test suite yet
- No production deployment plan yet

## Current Build Priorities

### Priority 1: Make Inventory Changes Traceable

**Status:** Database-side audit foundation is implemented. UI exposure and operator access are still pending.

**Goal:** Use the new audit foundation to support safer integration work and later dashboard history views.

Deliverables:

- [x] Create `audit_logs` table
- [x] Add DB trigger or function-based logging for inventory changes
- [ ] Expose read-only audit history in the dashboard later

Why this is first:

- It reduces risk while debugging webhook behavior
- It gives visibility into inventory mutations before real integrations are trusted

### Priority 2: Finish Shopify Inbound Flow

**Status:** Recorded payload replay now succeeds locally and verifies inventory plus audit-log side effects. Live Shopify delivery is still pending.

**Goal:** Accept a real Shopify event and push it through the local inventory path safely.

Deliverables:

- [x] Connect webhook payload handling to the existing inventory commit path
- [x] Validate signature handling with recorded payload replay
- [x] Add structured logging around webhook success/failure
- [x] Add local replay tooling and demo integration seed support
- [ ] Validate delivery from a live Shopify store or tunnel

Definition of done:

- A real or replayed Shopify webhook updates local inventory predictably
- The resulting state can be observed in the dashboard and database

### Priority 3: Finish ShipHero Inbound Flow

**Goal:** Validate the warehouse-side sync path using the existing RPC foundation.

Deliverables:

- Harden ShipHero webhook parsing and validation
- Map real payload fields to the existing sync event shape
- Validate both receiving and shipment flows against realistic events
- Add failure logging and an explicit retry strategy

Definition of done:

- Receiving and shipment payloads update inventory correctly without manual DB intervention

### Priority 4: Make The Dashboard Useful For Operators

**Goal:** Move from read-only proof of life to a usable operations screen.

Deliverables:

- Manual quantity adjustment form
- Safety floor display and edit path
- Flash mode toggle and reconciliation UI
- Search/filtering for inventory items

Definition of done:

- An authenticated tenant user can inspect and make controlled inventory changes from the UI

## Recommended Execution Order

1. Complete ShipHero inbound webhook handling and replay testing.
2. Add dashboard adjustment controls.
3. Expose audit history in the dashboard.
4. Add logout and settle the production auth strategy.
5. Add integration management UI.
6. Add automated integration tests around the stabilized webhook paths.
7. Validate live Shopify delivery against a tunnel or partner test store.

## Immediate Next Task

**Best next task:** validate and complete the ShipHero inbound webhook flow.

Why:

- The local replay path now proves the Shopify inbound flow works against recorded payloads.
- ShipHero is the next unvalidated external boundary and uses the same integration and audit foundations.
- Finishing ShipHero next keeps webhook risk reduction ahead of operator UI work.

## Open Decisions

### Authentication

- Keep production auth as email sign-in only, or add Shopify OAuth as a first-class path?

### Integration Testing

- Use recorded payload fixtures only, or require live/sandbox Shopify and ShipHero testing during development?

### Scope Control

- Keep Fishbowl and NetSuite out of MVP until Shopify and ShipHero are stable.

## Known Risks

- Webhook routes exist before they are fully validated against production-like payloads
- No dead-letter or retry queue means repeated failures can still drop operational events
- Audit events are stored, but there is not yet a UI or operator-facing query path for them
- Integration secrets/config can be stored per tenant, but there is not yet an operator-facing workflow for managing them
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

## Working Definition Of MVP

The MVP is done when all of the following are true:

- Authenticated users can sign in, get assigned to a tenant, and reach the dashboard
- Shopify inbound events can be validated and applied locally
- ShipHero inbound events can be validated and applied locally
- Inventory mutations are auditable
- Operators can review and make key inventory adjustments from the dashboard
- Local development remains reproducible from migrations, seed data, and documented commands
