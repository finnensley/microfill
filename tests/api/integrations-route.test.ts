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

import { GET, PATCH } from "@/app/api/integrations/route";

describe("/api/integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/integrations"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when the requested tenant does not match the signed-in user", async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mockGetTenantIdForUser.mockResolvedValue("tenant-1");

    const response = await GET(
      new Request("http://localhost/api/integrations?tenantId=tenant-2"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Requested tenant does not match the signed-in user.",
    });
  });

  it("returns tenant-scoped integrations for the signed-in user", async () => {
    const integrations = [
      {
        id: "integration-1",
        provider: "shopify",
        tenant_id: "tenant-1",
        status: "active",
      },
    ];

    mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mockGetTenantIdForUser.mockResolvedValue("tenant-1");

    const order = vi
      .fn()
      .mockResolvedValue({ data: integrations, error: null });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order,
    };

    mockCreateServerSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue(query),
    });

    const response = await GET(
      new Request("http://localhost/api/integrations?tenantId=tenant-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      integrations,
      tenantId: "tenant-1",
    });
  });

  it("rejects active Shopify integrations without a shop domain", async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mockGetTenantIdForUser.mockResolvedValue("tenant-1");

    const response = await PATCH(
      new Request("http://localhost/api/integrations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "shopify",
          status: "active",
          displayName: "Shopify",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Active Shopify integrations require an external shop domain.",
    });
  });

  it("normalizes and updates an existing integration record", async () => {
    const savedIntegration = {
      id: "integration-1",
      provider: "shopify",
      tenant_id: "tenant-1",
      status: "active",
      display_name: "Local Shopify Replay",
      external_shop_domain: "demo-shop.myshopify.com",
      external_account_id: "demo-shop",
      webhook_secret: "super-secret",
      api_key: null,
      api_secret: null,
      config: null,
      created_at: "2026-04-16T00:00:00.000Z",
      updated_at: "2026-04-16T00:00:00.000Z",
      last_error: null,
      last_synced_at: null,
    };

    mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mockGetTenantIdForUser.mockResolvedValue("tenant-1");

    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "integration-1" }, error: null });
    const lookupQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    };

    const single = vi
      .fn()
      .mockResolvedValue({ data: savedIntegration, error: null });
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

    const response = await PATCH(
      new Request("http://localhost/api/integrations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "shopify",
          status: "active",
          displayName: "  Local Shopify Replay  ",
          externalAccountId: " demo-shop ",
          externalShopDomain: " Demo-Shop.MyShopify.com ",
          webhookSecret: " super-secret ",
        }),
      }),
    );

    expect(update).toHaveBeenCalledWith({
      api_key: null,
      api_secret: null,
      config: {},
      display_name: "Local Shopify Replay",
      external_account_id: "demo-shop",
      external_shop_domain: "demo-shop.myshopify.com",
      provider: "shopify",
      status: "active",
      tenant_id: "tenant-1",
      webhook_secret: "super-secret",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      integration: savedIntegration,
      tenantId: "tenant-1",
    });
  });
});
