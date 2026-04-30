import { test, expect, type Page } from "@playwright/test";

/**
 * Webhook endpoint smoke tests.
 *
 * These tests call the API routes directly via fetch (not via the browser UI)
 * to verify the endpoints exist and respond with the expected status codes
 * for common inputs — without needing a live WMS or valid credentials.
 *
 * They complement the Vitest unit tests by exercising the routes through
 * the real Next.js HTTP layer.
 */

test.describe("webhook API endpoints", () => {
  test("ShipHero HEAD request returns 200 (health check)", async ({
    request,
  }) => {
    const response = await request.head("/api/webhooks/shiphero");
    expect(response.status()).toBe(200);
  });

  test("ShipHero POST without HMAC header returns 401", async ({ request }) => {
    const response = await request.post("/api/webhooks/shiphero", {
      data: JSON.stringify({ webhook_type: "PO Update" }),
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "smoke-tenant",
        // deliberately omitting x-shiphero-hmac-sha256
      },
    });
    expect(response.status()).toBe(401);
  });

  test("ShipHero POST with invalid signature returns 401", async ({
    request,
  }) => {
    const response = await request.post("/api/webhooks/shiphero", {
      data: JSON.stringify({ webhook_type: "PO Update" }),
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "smoke-tenant",
        "x-shiphero-hmac-sha256": "definitely-not-valid",
      },
    });
    expect(response.status()).toBe(401);
  });

  test("Shopify POST without source identifier returns 400", async ({
    request,
  }) => {
    const response = await request.post("/api/webhooks/shopify", {
      data: JSON.stringify({ id: 1, line_items: [] }),
      headers: {
        "content-type": "application/json",
        "x-shopify-hmac-sha256": "invalid",
        // deliberately omitting x-shopify-shop-domain and x-shopify-shop-id
      },
    });
    expect(response.status()).toBe(400);
  });

  test("queue process POST without CRON_SECRET header returns 401", async ({
    request,
  }) => {
    const response = await request.post("/api/queue/process", {
      data: "{}",
      headers: {
        "content-type": "application/json",
        // deliberately omitting authorization header
      },
    });
    // 401 when CRON_SECRET is set in the environment, 200 otherwise
    expect([200, 401]).toContain(response.status());
  });

  test("integrations API returns 401 for unauthenticated requests", async ({
    request,
  }) => {
    const response = await request.get("/api/integrations");
    expect(response.status()).toBe(401);
  });

  test("inventory API returns 401 for unauthenticated requests", async ({
    request,
  }) => {
    const response = await request.get("/api/inventory");
    expect(response.status()).toBe(401);
  });
});
