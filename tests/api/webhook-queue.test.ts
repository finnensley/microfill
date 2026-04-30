import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockCreateServerSupabaseClient,
  mockClaimWebhookEvents,
  mockGetWmsAdapter,
  mockProcessSyncEventsBatch,
} = vi.hoisted(() => ({
  mockCreateServerSupabaseClient: vi.fn(),
  mockClaimWebhookEvents: vi.fn(),
  mockGetWmsAdapter: vi.fn(),
  mockProcessSyncEventsBatch: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: mockCreateServerSupabaseClient,
}));

vi.mock("@/services/wms-adapters", () => ({
  getWmsAdapter: mockGetWmsAdapter,
}));

vi.mock("@/services/inventory-sync", () => ({
  processSyncEventsBatch: mockProcessSyncEventsBatch,
}));

// webhook-queue is only partially mocked so we can test enqueueWebhookEvent
// directly; claimNextBatch and mark* functions are also tested via the worker.
vi.mock("@/services/webhook-queue", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook-queue")>();
  return {
    ...actual,
    claimNextBatch: mockClaimWebhookEvents,
    markEventSucceeded: vi.fn().mockResolvedValue(undefined),
    markEventFailed: vi.fn().mockResolvedValue(undefined),
  };
});

import { POST as POST_WORKER } from "@/app/api/queue/process/route";
import { markEventSucceeded, markEventFailed } from "@/services/webhook-queue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<{
    id: string;
    provider: string;
    event_type: string;
    external_id: string;
    tenant_id: string;
    integration_id: string | null;
    payload: Record<string, unknown>;
    status: string;
    attempts: number;
    max_attempts: number;
    next_attempt_at: string;
  }> = {},
) {
  return {
    id: "event-uuid-1",
    provider: "shiphero",
    event_type: "PO Update",
    external_id: "PO-101",
    tenant_id: "tenant-1",
    integration_id: "integration-1",
    payload: {
      webhook_type: "PO Update",
      po_number: "PO-101",
      line_items: [{ sku: "SKU-1", quantity_received: 3 }],
    },
    status: "processing",
    attempts: 1,
    max_attempts: 3,
    next_attempt_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    provider_message_id: null,
    last_error: null,
    ...overrides,
  };
}

function makeNormalizeResult(overrides: { events?: unknown[] } = {}) {
  return {
    eventType: "PO Update",
    externalId: "PO-101",
    lineItemCount: 1,
    events: [
      {
        sku: "SKU-1",
        quantity: 3,
        type: "stock_received",
        tenantId: "tenant-1",
        source: "shiphero",
        externalId: "PO-101",
      },
    ],
    responseContext: {},
    ...(overrides.events !== undefined ? { events: overrides.events } : {}),
  };
}

function authorizedWorkerRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/queue/process", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-cron-secret",
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Queue worker tests
// ---------------------------------------------------------------------------

describe("queue worker (/api/queue/process)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  it("returns 401 when CRON_SECRET is set and authorization header is missing", async () => {
    const response = await POST_WORKER(
      new Request("http://localhost/api/queue/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when the CRON_SECRET does not match the authorization header", async () => {
    const response = await POST_WORKER(
      new Request("http://localhost/api/queue/process", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wrong-secret",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns { processed: 0 } when the queue is empty", async () => {
    mockClaimWebhookEvents.mockResolvedValue([]);

    const response = await POST_WORKER(authorizedWorkerRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ processed: 0 });
  });

  it("processes a batch and marks events succeeded", async () => {
    const event = makeEvent();
    mockClaimWebhookEvents.mockResolvedValue([event]);

    const mockAdapter = {
      normalize: vi.fn().mockReturnValue(makeNormalizeResult()),
    };
    mockGetWmsAdapter.mockReturnValue(mockAdapter);
    mockProcessSyncEventsBatch.mockResolvedValue({ failed: 0, succeeded: 1 });

    const response = await POST_WORKER(authorizedWorkerRequest());

    expect(mockAdapter.normalize).toHaveBeenCalledWith(
      JSON.stringify(event.payload),
      "tenant-1",
    );
    expect(mockProcessSyncEventsBatch).toHaveBeenCalledWith(
      makeNormalizeResult().events,
    );
    expect(markEventSucceeded).toHaveBeenCalledWith("event-uuid-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it("marks an event failed and schedules retry when sync fails", async () => {
    const event = makeEvent({ attempts: 1, max_attempts: 3 });
    mockClaimWebhookEvents.mockResolvedValue([event]);

    const mockAdapter = {
      normalize: vi.fn().mockReturnValue(makeNormalizeResult()),
    };
    mockGetWmsAdapter.mockReturnValue(mockAdapter);
    mockProcessSyncEventsBatch.mockResolvedValue({ failed: 1, succeeded: 0 });

    const response = await POST_WORKER(authorizedWorkerRequest());

    expect(markEventFailed).toHaveBeenCalledWith(
      "event-uuid-1",
      expect.stringContaining("failed"),
      1,
      3,
    );
    expect(markEventSucceeded).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
  });

  it("dead-letters an event after all attempts are exhausted", async () => {
    const event = makeEvent({ attempts: 3, max_attempts: 3 });
    mockClaimWebhookEvents.mockResolvedValue([event]);

    const mockAdapter = {
      normalize: vi.fn().mockReturnValue(makeNormalizeResult()),
    };
    mockGetWmsAdapter.mockReturnValue(mockAdapter);
    mockProcessSyncEventsBatch.mockResolvedValue({ failed: 1, succeeded: 0 });

    await POST_WORKER(authorizedWorkerRequest());

    expect(markEventFailed).toHaveBeenCalledWith(
      "event-uuid-1",
      expect.any(String),
      3,
      3,
    );
  });

  it("marks an event succeeded when there are no line items to process", async () => {
    const event = makeEvent({
      payload: {
        webhook_type: "PO Update",
        po_number: "PO-EMPTY",
        line_items: [],
      },
    });
    mockClaimWebhookEvents.mockResolvedValue([event]);

    const mockAdapter = {
      normalize: vi.fn().mockReturnValue(makeNormalizeResult({ events: [] })),
    };
    mockGetWmsAdapter.mockReturnValue(mockAdapter);

    await POST_WORKER(authorizedWorkerRequest());

    expect(mockProcessSyncEventsBatch).not.toHaveBeenCalled();
    expect(markEventSucceeded).toHaveBeenCalledWith("event-uuid-1");
  });

  it("marks an event failed when no adapter is registered for its provider", async () => {
    const event = makeEvent({ provider: "unknown-wms" });
    mockClaimWebhookEvents.mockResolvedValue([event]);
    mockGetWmsAdapter.mockReturnValue(null);

    const response = await POST_WORKER(authorizedWorkerRequest());

    expect(markEventFailed).toHaveBeenCalledWith(
      "event-uuid-1",
      expect.stringContaining("unknown-wms"),
      event.attempts,
      event.max_attempts,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ failed: 1 });
  });

  it("marks an event failed when the adapter throws an unexpected error", async () => {
    const event = makeEvent();
    mockClaimWebhookEvents.mockResolvedValue([event]);

    const mockAdapter = {
      normalize: vi.fn().mockImplementation(() => {
        throw new Error("adapter exploded");
      }),
    };
    mockGetWmsAdapter.mockReturnValue(mockAdapter);

    const response = await POST_WORKER(authorizedWorkerRequest());

    expect(markEventFailed).toHaveBeenCalledWith(
      "event-uuid-1",
      "adapter exploded",
      event.attempts,
      event.max_attempts,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ failed: 1 });
  });
});
