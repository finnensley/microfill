import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateServerSupabaseClient,
  mockGetAuthenticatedUser,
  mockGetTenantIdForUser,
} = vi.hoisted(() => ({
  mockCreateServerSupabaseClient: vi.fn(),
  mockGetAuthenticatedUser: vi.fn(),
  mockGetTenantIdForUser: vi.fn(),
}));

vi.mock("@/lib/supabase-auth-server", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
  getTenantIdForUser: mockGetTenantIdForUser,
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: mockCreateServerSupabaseClient,
}));

import { GET as GET_AUDIT } from "@/app/api/inventory/audit/route";
import { PATCH as PATCH_INVENTORY } from "@/app/api/inventory/route";

describe("inventory dashboard API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mockGetTenantIdForUser.mockResolvedValue("tenant-1");
  });

  it("rejects inventory updates below committed quantity", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "item-1", tenant_id: "tenant-1", committed_quantity: 6 },
      error: null,
    });

    mockCreateServerSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle,
      }),
    });

    const response = await PATCH_INVENTORY(
      new Request("http://localhost/api/inventory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: "item-1", totalQuantity: 5 }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "totalQuantity cannot be lower than the currently committed quantity.",
    });
  });

  it("updates inventory item fields for the active tenant", async () => {
    const updatedItem = {
      id: "item-1",
      tenant_id: "tenant-1",
      total_quantity: 25,
      safety_floor_percent: 15,
      flash_mode_enabled: true,
    };

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "item-1", tenant_id: "tenant-1", committed_quantity: 4 },
      error: null,
    });
    const lookupQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    };

    const single = vi
      .fn()
      .mockResolvedValue({ data: updatedItem, error: null });
    const updateQuery = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnValue({ single }),
    };
    const update = vi.fn().mockReturnValue(updateQuery);

    mockCreateServerSupabaseClient.mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(lookupQuery)
        .mockReturnValueOnce({ update }),
    });

    const response = await PATCH_INVENTORY(
      new Request("http://localhost/api/inventory", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: "item-1",
          totalQuantity: 25,
          safetyFloorPercent: 15,
          flashModeEnabled: true,
        }),
      }),
    );

    expect(update).toHaveBeenCalledWith({
      total_quantity: 25,
      safety_floor_percent: 15,
      flash_mode_enabled: true,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      item: updatedItem,
      tenantId: "tenant-1",
    });
  });

  it("clamps audit history limit and enriches inventory labels", async () => {
    const logs = [
      {
        id: "log-1",
        action: "UPDATE",
        actor_role: "database_trigger",
        actor_user_id: null,
        changed_columns: ["total_quantity"],
        created_at: "2026-04-16T00:00:00.000Z",
        inventory_item_id: "item-1",
        new_values: { total_quantity: 10 },
        old_values: { total_quantity: 8 },
        source: "shiphero",
        tenant_id: "tenant-1",
      },
    ];

    const inventoryRows = [
      { id: "item-1", sku: "SKU-DEMO", shopify_product_id: "product-1" },
    ];

    const limit = vi.fn().mockResolvedValue({ data: logs, error: null });
    const auditQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit,
    };
    const inventoryQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: inventoryRows, error: null }),
    };

    mockCreateServerSupabaseClient.mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(auditQuery)
        .mockReturnValueOnce(inventoryQuery),
    });

    const response = await GET_AUDIT(
      new Request(
        "http://localhost/api/inventory/audit?tenantId=tenant-1&limit=100",
      ),
    );

    expect(limit).toHaveBeenCalledWith(50);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      history: [
        {
          ...logs[0],
          itemLabel: "SKU-DEMO",
          itemProductId: "product-1",
          itemSku: "SKU-DEMO",
        },
      ],
      tenantId: "tenant-1",
    });
  });
});
