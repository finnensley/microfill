# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api-smoke.spec.ts >> webhook API endpoints >> ShipHero POST with invalid signature returns 401
- Location: tests/e2e/api-smoke.spec.ts:34:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 401
Received: 500
```

# Test source

```ts
  1  | import { test, expect, type Page } from "@playwright/test";
  2  | 
  3  | /**
  4  |  * Webhook endpoint smoke tests.
  5  |  *
  6  |  * These tests call the API routes directly via fetch (not via the browser UI)
  7  |  * to verify the endpoints exist and respond with the expected status codes
  8  |  * for common inputs — without needing a live WMS or valid credentials.
  9  |  *
  10 |  * They complement the Vitest unit tests by exercising the routes through
  11 |  * the real Next.js HTTP layer.
  12 |  */
  13 | 
  14 | test.describe("webhook API endpoints", () => {
  15 |   test("ShipHero HEAD request returns 200 (health check)", async ({
  16 |     request,
  17 |   }) => {
  18 |     const response = await request.head("/api/webhooks/shiphero");
  19 |     expect(response.status()).toBe(200);
  20 |   });
  21 | 
  22 |   test("ShipHero POST without HMAC header returns 401", async ({ request }) => {
  23 |     const response = await request.post("/api/webhooks/shiphero", {
  24 |       data: JSON.stringify({ webhook_type: "PO Update" }),
  25 |       headers: {
  26 |         "content-type": "application/json",
  27 |         "x-tenant-id": "smoke-tenant",
  28 |         // deliberately omitting x-shiphero-hmac-sha256
  29 |       },
  30 |     });
  31 |     expect(response.status()).toBe(401);
  32 |   });
  33 | 
  34 |   test("ShipHero POST with invalid signature returns 401", async ({
  35 |     request,
  36 |   }) => {
  37 |     const response = await request.post("/api/webhooks/shiphero", {
  38 |       data: JSON.stringify({ webhook_type: "PO Update" }),
  39 |       headers: {
  40 |         "content-type": "application/json",
  41 |         "x-tenant-id": "smoke-tenant",
  42 |         "x-shiphero-hmac-sha256": "definitely-not-valid",
  43 |       },
  44 |     });
> 45 |     expect(response.status()).toBe(401);
     |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  46 |   });
  47 | 
  48 |   test("Shopify POST without source identifier returns 400", async ({
  49 |     request,
  50 |   }) => {
  51 |     const response = await request.post("/api/webhooks/shopify", {
  52 |       data: JSON.stringify({ id: 1, line_items: [] }),
  53 |       headers: {
  54 |         "content-type": "application/json",
  55 |         "x-shopify-hmac-sha256": "invalid",
  56 |         // deliberately omitting x-shopify-shop-domain and x-shopify-shop-id
  57 |       },
  58 |     });
  59 |     expect(response.status()).toBe(400);
  60 |   });
  61 | 
  62 |   test("queue process POST without CRON_SECRET header returns 401", async ({
  63 |     request,
  64 |   }) => {
  65 |     const response = await request.post("/api/queue/process", {
  66 |       data: "{}",
  67 |       headers: {
  68 |         "content-type": "application/json",
  69 |         // deliberately omitting authorization header
  70 |       },
  71 |     });
  72 |     // 401 when CRON_SECRET is set in the environment, 200 otherwise
  73 |     expect([200, 401]).toContain(response.status());
  74 |   });
  75 | 
  76 |   test("integrations API returns 401 for unauthenticated requests", async ({
  77 |     request,
  78 |   }) => {
  79 |     const response = await request.get("/api/integrations");
  80 |     expect(response.status()).toBe(401);
  81 |   });
  82 | 
  83 |   test("inventory API returns 401 for unauthenticated requests", async ({
  84 |     request,
  85 |   }) => {
  86 |     const response = await request.get("/api/inventory");
  87 |     expect(response.status()).toBe(401);
  88 |   });
  89 | });
  90 | 
```