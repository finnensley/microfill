import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCreateServerSupabaseClient } = vi.hoisted(() => ({
  mockCreateServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: mockCreateServerSupabaseClient,
}));

import { GET as GET_ALERT } from "@/app/api/queue/alert/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CRON_SECRET = "test-cron-secret";

function makeRequest(authHeader?: string) {
  return new Request("http://localhost/api/queue/alert", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function buildSupabaseMock(
  rows: unknown[],
  error: { message: string } | null = null,
) {
  const limitFn = vi.fn().mockResolvedValue({ data: rows, error });
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: limitFn,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/queue/alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  it("returns 401 when CRON_SECRET is set and Authorization header is missing", async () => {
    const response = await GET_ALERT(makeRequest());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Unauthorized",
    });
  });

  it("returns 401 when Authorization header has wrong value", async () => {
    const response = await GET_ALERT(makeRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("returns 200 { alert: false } when there are no dead-letter events", async () => {
    mockCreateServerSupabaseClient.mockReturnValue(buildSupabaseMock([]));

    const response = await GET_ALERT(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      alert: false,
      dead_letter_count: 0,
    });
  });

  it("returns 409 { alert: true } with samples when dead-letter events exist", async () => {
    const deadEvent = {
      id: "evt-1",
      tenant_id: "tenant-1",
      provider: "shiphero",
      event_type: "Shipment Update",
      last_error: "SKU not found",
      updated_at: "2026-04-30T00:00:00.000Z",
      attempts: 3,
      max_attempts: 3,
    };
    mockCreateServerSupabaseClient.mockReturnValue(
      buildSupabaseMock([deadEvent]),
    );

    const response = await GET_ALERT(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.alert).toBe(true);
    expect(body.dead_letter_count).toBe(1);
    expect(body.samples).toHaveLength(1);
    expect(body.samples[0]).toMatchObject({
      id: "evt-1",
      provider: "shiphero",
      event_type: "Shipment Update",
      last_error: "SKU not found",
    });
  });

  it("returns 500 when the Supabase query fails", async () => {
    mockCreateServerSupabaseClient.mockReturnValue(
      buildSupabaseMock([], { message: "connection error" }),
    );

    const response = await GET_ALERT(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(500);
  });

  it("allows access when CRON_SECRET env var is unset", async () => {
    delete process.env.CRON_SECRET;
    mockCreateServerSupabaseClient.mockReturnValue(buildSupabaseMock([]));

    const response = await GET_ALERT(makeRequest());
    expect(response.status).toBe(200);
  });
});
