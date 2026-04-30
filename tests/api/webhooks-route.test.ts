import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateServerSupabaseClient,
  mockEnqueueWebhookEvent,
  mockResolveIntegration,
} = vi.hoisted(() => ({
  mockCreateServerSupabaseClient: vi.fn(),
  mockEnqueueWebhookEvent: vi.fn(),
  mockResolveIntegration: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: mockCreateServerSupabaseClient,
}));

vi.mock("@/services/integrations", () => ({
  resolveIntegration: mockResolveIntegration,
}));

vi.mock("@/services/webhook-queue", () => ({
  enqueueWebhookEvent: mockEnqueueWebhookEvent,
}));

import {
  HEAD as HEAD_SHIPHERO,
  POST as POST_SHIPHERO,
} from "@/app/api/webhooks/shiphero/route";
import { POST as POST_SHOPIFY } from "@/app/api/webhooks/shopify/route";

function createIntegrationUpdateMock() {
  const eqTenantId = vi.fn().mockResolvedValue({ error: null });
  const eqId = vi.fn().mockReturnValue({ eq: eqTenantId });
  const update = vi.fn().mockReturnValue({ eq: eqId });

  return {
    eqId,
    eqTenantId,
    update,
  };
}

function createShopifySupabaseClient(params: {
  inventoryItem: { id: string } | null;
  inventoryError?: { message: string } | null;
}) {
  const single = vi.fn().mockResolvedValue({
    data: params.inventoryItem,
    error: params.inventoryError ?? null,
  });
  const inventoryQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single,
  };
  const integrationUpdate = createIntegrationUpdateMock();
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "inventory_items") {
      return inventoryQuery;
    }

    if (table === "integrations") {
      return {
        update: integrationUpdate.update,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    from,
    integrationUpdate,
    inventoryQuery,
    rpc,
    single,
    supabase: {
      from,
      rpc,
    },
  };
}

function createIntegrationStatusSupabaseClient() {
  const integrationUpdate = createIntegrationUpdateMock();
  const from = vi.fn((table: string) => {
    if (table === "integrations") {
      return {
        update: integrationUpdate.update,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    integrationUpdate,
    supabase: {
      from,
    },
  };
}

describe("webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects Shopify webhooks without a source identifier", async () => {
    const response = await POST_SHOPIFY(
      new Request("http://localhost/api/webhooks/shopify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": "invalid",
        },
        body: JSON.stringify({ id: 1, line_items: [] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook source",
    });
  });

  it("processes Shopify order line items with a valid signature", async () => {
    const payload = {
      id: 101,
      line_items: [{ variant_id: "variant-1", quantity: 2 }],
    };
    const rawBody = JSON.stringify(payload);
    const secret = "shopify-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    mockResolveIntegration.mockResolvedValue({
      id: "integration-1",
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });

    const shopifyClient = createShopifySupabaseClient({
      inventoryItem: { id: "item-1" },
    });

    mockCreateServerSupabaseClient.mockReturnValue(shopifyClient.supabase);

    const response = await POST_SHOPIFY(
      new Request("http://localhost/api/webhooks/shopify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": signature,
          "x-shopify-shop-domain": "demo-shop.myshopify.com",
          "x-shopify-shop-id": "demo-shop",
        },
        body: rawBody,
      }),
    );

    expect(shopifyClient.rpc).toHaveBeenCalledWith(
      "increment_committed_quantity",
      {
        amount: 2,
        item_id: "item-1",
        tenant_id_input: "tenant-1",
      },
    );
    expect(shopifyClient.integrationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: null,
        last_synced_at: expect.any(String),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failed: 0,
      lineResults: [
        {
          inventoryItemId: "item-1",
          quantity: 2,
          status: "processed",
          variantId: "variant-1",
        },
      ],
      orderId: 101,
      processed: 1,
      received: true,
      skipped: 0,
      verified: true,
    });
  });

  it("skips Shopify line items that do not include a variant ID", async () => {
    const payload = {
      id: 102,
      line_items: [
        { variant_id: null, quantity: 1 },
        { variant_id: "variant-1", quantity: 2 },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const secret = "shopify-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    mockResolveIntegration.mockResolvedValue({
      id: "integration-1",
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });

    const shopifyClient = createShopifySupabaseClient({
      inventoryItem: { id: "item-1" },
    });

    mockCreateServerSupabaseClient.mockReturnValue(shopifyClient.supabase);

    const response = await POST_SHOPIFY(
      new Request("http://localhost/api/webhooks/shopify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": signature,
          "x-shopify-shop-domain": "demo-shop.myshopify.com",
          "x-shopify-shop-id": "demo-shop",
        },
        body: rawBody,
      }),
    );

    expect(shopifyClient.rpc).toHaveBeenCalledTimes(1);
    expect(shopifyClient.integrationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error:
          "order=102 processed=1 skipped=1 failed=0 lines=skipped:nonex1:missing_variant_id, processed:variant-1x2",
        last_synced_at: expect.any(String),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failed: 0,
      lineResults: [
        {
          quantity: 1,
          reason: "missing_variant_id",
          status: "skipped",
          variantId: null,
        },
        {
          inventoryItemId: "item-1",
          quantity: 2,
          status: "processed",
          variantId: "variant-1",
        },
      ],
      orderId: 102,
      processed: 1,
      received: true,
      skipped: 1,
      verified: true,
    });
  });

  it("reports skipped Shopify variants that do not match local inventory", async () => {
    const payload = {
      id: 103,
      line_items: [{ variant_id: "variant-missing", quantity: 1 }],
    };
    const rawBody = JSON.stringify(payload);
    const secret = "shopify-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    mockResolveIntegration.mockResolvedValue({
      id: "integration-1",
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });

    const shopifyClient = createShopifySupabaseClient({
      inventoryItem: null,
    });

    mockCreateServerSupabaseClient.mockReturnValue(shopifyClient.supabase);

    const response = await POST_SHOPIFY(
      new Request("http://localhost/api/webhooks/shopify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": signature,
          "x-shopify-shop-domain": "demo-shop.myshopify.com",
          "x-shopify-shop-id": "demo-shop",
        },
        body: rawBody,
      }),
    );

    expect(shopifyClient.rpc).not.toHaveBeenCalled();
    expect(shopifyClient.integrationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error:
          "order=103 processed=0 skipped=1 failed=0 lines=skipped:variant-missingx1:inventory_item_not_found",
        last_synced_at: expect.any(String),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failed: 0,
      lineResults: [
        {
          quantity: 1,
          reason: "inventory_item_not_found",
          status: "skipped",
          variantId: "variant-missing",
        },
      ],
      orderId: 103,
      processed: 0,
      received: true,
      skipped: 1,
      verified: true,
    });
  });

  it("stores a Shopify integration error when the webhook signature is invalid", async () => {
    const payload = {
      id: 104,
      line_items: [{ variant_id: "variant-1", quantity: 1 }],
    };

    mockResolveIntegration.mockResolvedValue({
      external_shop_domain: "demo-shop.myshopify.com",
      id: "integration-1",
      tenant_id: "tenant-1",
      webhook_secret: "shopify-secret",
    });

    const shopifyClient = createShopifySupabaseClient({
      inventoryItem: { id: "item-1" },
    });

    mockCreateServerSupabaseClient.mockReturnValue(shopifyClient.supabase);

    const response = await POST_SHOPIFY(
      new Request("http://localhost/api/webhooks/shopify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": "invalid-signature",
          "x-shopify-shop-domain": "demo-shop.myshopify.com",
          "x-shopify-shop-id": "demo-shop",
        },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(401);
    expect(shopifyClient.integrationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error:
          "Invalid Shopify webhook signature for demo-shop.myshopify.com",
        last_synced_at: expect.any(String),
      }),
    );
  });

  it("rejects ShipHero webhooks with an invalid signature", async () => {
    const shipHeroClient = createIntegrationStatusSupabaseClient();

    mockResolveIntegration.mockResolvedValue({
      id: "integration-shiphero-1",
      tenant_id: "tenant-1",
      webhook_secret: "shiphero-secret",
    });

    mockCreateServerSupabaseClient.mockReturnValue(shipHeroClient.supabase);

    const response = await POST_SHIPHERO(
      new Request("http://localhost/api/webhooks/shiphero", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": "tenant-1",
          "x-shiphero-webhook-signature": "invalid-signature",
        },
        body: JSON.stringify({ webhook_type: "PO Update", line_items: [] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(shipHeroClient.integrationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          shipheroWebhookStatus: expect.objectContaining({
            failureKind: "invalid_signature",
            retryMode: "fix_configuration",
            retryRecommended: false,
          }),
        }),
        last_error: "Invalid ShipHero webhook signature for tenant-1",
        last_synced_at: expect.any(String),
      }),
    );
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("responds to ShipHero HEAD validation requests", async () => {
    const response = await HEAD_SHIPHERO();

    expect(response.status).toBe(200);
  });

  it("enqueues ShipHero PO update payloads after signature verification", async () => {
    const payload = {
      webhook_type: "PO Update",
      po_number: "PO-101",
      line_items: [
        { sku: "SKU-1", quantity_received: 3 },
        { sku: "SKU-2", quantity_received: 1 },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const secret = "shiphero-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    const shipHeroClient = createIntegrationStatusSupabaseClient();

    mockResolveIntegration.mockResolvedValue({
      id: "integration-shiphero-1",
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });
    mockEnqueueWebhookEvent.mockResolvedValue({ id: "event-uuid-1" });

    mockCreateServerSupabaseClient.mockReturnValue(shipHeroClient.supabase);

    const response = await POST_SHIPHERO(
      new Request("http://localhost/api/webhooks/shiphero", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shiphero-account-id": "warehouse-1",
          "x-shiphero-hmac-sha256": signature,
        },
        body: rawBody,
      }),
    );

    expect(mockEnqueueWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "shiphero",
        tenant_id: "tenant-1",
        integration_id: "integration-shiphero-1",
        event_type: "PO Update",
        external_id: "PO-101",
        payload: expect.objectContaining({ webhook_type: "PO Update" }),
      }),
    );
    expect(shipHeroClient.integrationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_synced_at: expect.any(String),
        last_error: null,
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eventId: "event-uuid-1",
      eventType: "PO Update",
      provider: "shiphero",
      queued: true,
      verified: true,
    });
  });

  it("enqueues documented ShipHero PO envelopes and resolves warehouse_id for integration lookup", async () => {
    const payload = {
      purchase_order: {
        webhook_type: "PO Update",
        po_id: 31,
        po_number: "PO 31",
        status: "pending",
        warehouse_id: 76733,
        line_items: [{ sku: "SKU-1", quantity_received: 5 }],
      },
      test: "0",
    };
    const rawBody = JSON.stringify(payload);
    const secret = "shiphero-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    const shipHeroClient = createIntegrationStatusSupabaseClient();

    mockResolveIntegration.mockResolvedValue({
      id: "integration-shiphero-1",
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });
    mockEnqueueWebhookEvent.mockResolvedValue({ id: "event-uuid-2" });

    mockCreateServerSupabaseClient.mockReturnValue(shipHeroClient.supabase);

    const response = await POST_SHIPHERO(
      new Request("http://localhost/api/webhooks/shiphero", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shiphero-hmac-sha256": signature,
        },
        body: rawBody,
      }),
    );

    expect(mockResolveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        externalAccountId: "76733",
      }),
    );
    expect(mockEnqueueWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "shiphero",
        tenant_id: "tenant-1",
        external_id: "PO 31",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("enqueues ShipHero shipment update payloads after signature verification", async () => {
    const payload = {
      webhook_type: "Shipment Update",
      order_number: "ORDER-101",
      tracking_number: "TRACK-123",
      line_items: [{ sku: "SKU-1", quantity: 2 }],
    };
    const rawBody = JSON.stringify(payload);
    const secret = "shiphero-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    const shipHeroClient = createIntegrationStatusSupabaseClient();

    mockResolveIntegration.mockResolvedValue({
      id: "integration-shiphero-1",
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });
    mockEnqueueWebhookEvent.mockResolvedValue({ id: "event-uuid-3" });

    mockCreateServerSupabaseClient.mockReturnValue(shipHeroClient.supabase);

    const response = await POST_SHIPHERO(
      new Request("http://localhost/api/webhooks/shiphero", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shiphero-account-id": "warehouse-1",
          "x-shiphero-hmac-sha256": signature,
        },
        body: rawBody,
      }),
    );

    expect(mockEnqueueWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "shiphero",
        tenant_id: "tenant-1",
        event_type: "Shipment Update",
        external_id: "ORDER-101",
      }),
    );
    expect(shipHeroClient.integrationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_synced_at: expect.any(String),
        last_error: null,
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      eventId: "event-uuid-3",
      eventType: "Shipment Update",
      provider: "shiphero",
      queued: true,
      verified: true,
    });
  });

  it("enqueues documented ShipHero shipment envelopes", async () => {
    const payload = {
      webhook_type: "Shipment Update",
      fulfillment: {
        webhook_type: "Shipment Update",
        warehouse_id: 76733,
        order_id: 1001,
        order_number: "ORDER-101",
        tracking_number: "TRACK-123",
        line_items: [{ sku: "SKU-1", quantity: 2 }],
      },
    };
    const rawBody = JSON.stringify(payload);
    const secret = "shiphero-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    const shipHeroClient = createIntegrationStatusSupabaseClient();

    mockResolveIntegration.mockResolvedValue({
      id: "integration-shiphero-1",
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });
    mockEnqueueWebhookEvent.mockResolvedValue({ id: "event-uuid-4" });

    mockCreateServerSupabaseClient.mockReturnValue(shipHeroClient.supabase);

    const response = await POST_SHIPHERO(
      new Request("http://localhost/api/webhooks/shiphero", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shiphero-hmac-sha256": signature,
          "x-tenant-id": "tenant-1",
        },
        body: rawBody,
      }),
    );

    expect(mockEnqueueWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "shiphero",
        tenant_id: "tenant-1",
        event_type: "Shipment Update",
        external_id: "ORDER-101",
      }),
    );
    expect(response.status).toBe(200);
  });
});
