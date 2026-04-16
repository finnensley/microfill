import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateServerSupabaseClient,
  mockProcessSyncEventsBatch,
  mockResolveIntegration,
} = vi.hoisted(() => ({
  mockCreateServerSupabaseClient: vi.fn(),
  mockProcessSyncEventsBatch: vi.fn(),
  mockResolveIntegration: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: mockCreateServerSupabaseClient,
}));

vi.mock("@/services/integrations", () => ({
  resolveIntegration: mockResolveIntegration,
}));

vi.mock("@/services/inventory-sync", () => ({
  processSyncEventsBatch: mockProcessSyncEventsBatch,
}));

import { POST as POST_SHIPHERO } from "@/app/api/webhooks/shiphero/route";
import { POST as POST_SHOPIFY } from "@/app/api/webhooks/shopify/route";

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
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });

    const single = vi
      .fn()
      .mockResolvedValue({ data: { id: "item-1" }, error: null });
    const inventoryQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single,
    };
    const rpc = vi.fn().mockResolvedValue({ error: null });

    mockCreateServerSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue(inventoryQuery),
      rpc,
    });

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

    expect(rpc).toHaveBeenCalledWith("increment_committed_quantity", {
      amount: 2,
      item_id: "item-1",
      tenant_id_input: "tenant-1",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failed: 0,
      orderId: 101,
      processed: 1,
      received: true,
      skipped: 0,
      verified: true,
    });
  });

  it("rejects ShipHero webhooks with an invalid signature", async () => {
    mockResolveIntegration.mockResolvedValue({
      tenant_id: "tenant-1",
      webhook_secret: "shiphero-secret",
    });

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
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("normalizes ShipHero PO updates into inventory events", async () => {
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

    mockResolveIntegration.mockResolvedValue({
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });
    mockProcessSyncEventsBatch.mockResolvedValue({ failed: 0, succeeded: 2 });

    const response = await POST_SHIPHERO(
      new Request("http://localhost/api/webhooks/shiphero", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shiphero-account-id": "warehouse-1",
          "x-shiphero-webhook-signature": signature,
        },
        body: rawBody,
      }),
    );

    expect(mockProcessSyncEventsBatch).toHaveBeenCalledWith([
      {
        externalId: "PO-101",
        quantity: 3,
        sku: "SKU-1",
        source: "shiphero",
        tenantId: "tenant-1",
        type: "stock_received",
      },
      {
        externalId: "PO-101",
        quantity: 1,
        sku: "SKU-2",
        source: "shiphero",
        tenantId: "tenant-1",
        type: "stock_received",
      },
    ]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failed: 0,
      lineItems: 2,
      message: "PO synced",
      po_number: "PO-101",
      succeeded: 2,
      tenantId: "tenant-1",
      verified: true,
      webhookType: "PO Update",
    });
  });

  it("normalizes ShipHero shipment updates into inventory events", async () => {
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

    mockResolveIntegration.mockResolvedValue({
      tenant_id: "tenant-1",
      webhook_secret: secret,
    });
    mockProcessSyncEventsBatch.mockResolvedValue({ failed: 0, succeeded: 1 });

    const response = await POST_SHIPHERO(
      new Request("http://localhost/api/webhooks/shiphero", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shiphero-account-id": "warehouse-1",
          "x-shiphero-webhook-signature": signature,
        },
        body: rawBody,
      }),
    );

    expect(mockProcessSyncEventsBatch).toHaveBeenCalledWith([
      {
        externalId: "ORDER-101",
        quantity: 2,
        sku: "SKU-1",
        source: "shiphero",
        tenantId: "tenant-1",
        type: "stock_shipped",
      },
    ]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failed: 0,
      lineItems: 1,
      message: "Shipment synced",
      succeeded: 1,
      tenantId: "tenant-1",
      tracking: "TRACK-123",
      verified: true,
      webhookType: "Shipment Update",
    });
  });
});
