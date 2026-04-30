"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInventory } from "@/hooks/use-inventory";
import {
  managedIntegrationProviders,
  ManagedIntegrationProvider,
  ManagedIntegrationRecord,
} from "@/types/integrations";
import { InventoryAuditEntry, InventoryItem } from "@/types/inventory";

interface InventoryDashboardProps {
  tenantId: string | null;
}

type AuditHistoryFilter = "all" | "exceptions" | "operator" | "syncs";

type DraftItemState = {
  flashModeEnabled: boolean;
  safetyFloorPercent: string;
  totalQuantity: string;
};

type IntegrationDraftState = {
  apiKey: string;
  apiSecret: string;
  displayName: string;
  externalAccountId: string;
  externalShopDomain: string;
  shopifyLocationId: string;
  status: "draft" | "active" | "disabled" | "error";
  webhookSecret: string;
};

type QueueStatus = {
  counts: {
    dead_letter: number;
    failed: number;
    pending: number;
    processing: number;
    succeeded: number;
  };
  recentFailed: Array<{
    attempts: number;
    event_type: string;
    id: string;
    last_error: string | null;
    max_attempts: number;
    provider: string;
    updated_at: string;
  }>;
  total: number;
};

type ShipHeroWebhookStatus = {
  failed: number;
  failureKind: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastResult: string | null;
  lastWebhookType: string | null;
  lineItems: number;
  operatorAction: string | null;
  retryCommand: string | null;
  retryMode: string | null;
  retryRecommended: boolean;
  succeeded: number;
};

function createIntegrationDraft(
  integration?: ManagedIntegrationRecord,
): IntegrationDraftState {
  const config = (integration?.config as Record<string, unknown> | null) ?? {};
  return {
    apiKey: integration?.api_key ?? "",
    apiSecret: integration?.api_secret ?? "",
    displayName: integration?.display_name ?? "",
    externalAccountId: integration?.external_account_id ?? "",
    externalShopDomain: integration?.external_shop_domain ?? "",
    shopifyLocationId:
      typeof config.shopifyLocationId === "string"
        ? config.shopifyLocationId
        : "",
    status:
      integration?.status === "active" ||
      integration?.status === "disabled" ||
      integration?.status === "error"
        ? integration.status
        : "draft",
    webhookSecret: integration?.webhook_secret ?? "",
  };
}

function createDraftState(item: InventoryItem): DraftItemState {
  return {
    totalQuantity: String(item.total_quantity),
    safetyFloorPercent: String(item.safety_floor_percent),
    flashModeEnabled: Boolean(item.flash_mode_enabled),
  };
}

function formatAuditValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "-";
  }

  return JSON.stringify(value);
}

function formatChangedField(field: string) {
  return field
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function summarizeAuditChanges(entry: InventoryAuditEntry) {
  const fields = entry.changed_columns ?? [];

  if (fields.length === 0) {
    return [];
  }

  const oldValues =
    entry.old_values &&
    typeof entry.old_values === "object" &&
    !Array.isArray(entry.old_values)
      ? entry.old_values
      : {};
  const newValues =
    entry.new_values &&
    typeof entry.new_values === "object" &&
    !Array.isArray(entry.new_values)
      ? entry.new_values
      : {};

  return fields.map((field) => {
    const oldValue = Reflect.get(oldValues, field) as unknown;
    const newValue = Reflect.get(newValues, field) as unknown;

    return `${formatChangedField(field)}: ${formatAuditValue(oldValue)} -> ${formatAuditValue(newValue)}`;
  });
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function readObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function getShipHeroWebhookStatus(
  integration?: ManagedIntegrationRecord | null,
): ShipHeroWebhookStatus | null {
  const config = readObject(integration?.config);
  const status = readObject(config?.shipheroWebhookStatus);

  if (!status) {
    return null;
  }

  return {
    failed: readNumber(status.failed),
    failureKind: readString(status.failureKind),
    lastAttemptAt: readString(status.lastAttemptAt),
    lastError: readString(status.lastError),
    lastResult: readString(status.lastResult),
    lastWebhookType: readString(status.lastWebhookType),
    lineItems: readNumber(status.lineItems),
    operatorAction: readString(status.operatorAction),
    retryCommand: readString(status.retryCommand),
    retryMode: readString(status.retryMode),
    retryRecommended: readBoolean(status.retryRecommended),
    succeeded: readNumber(status.succeeded),
  };
}

export default function InventoryDashboard({
  tenantId,
}: InventoryDashboardProps) {
  const { items, loading, error, refresh, page, totalPages, total, goToPage } =
    useInventory(tenantId || undefined);
  const [searchTerm, setSearchTerm] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftItemState>>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"error" | "success" | null>(
    null,
  );
  const [auditHistory, setAuditHistory] = useState<InventoryAuditEntry[]>([]);
  const [auditDisplayLimit, setAuditDisplayLimit] = useState<12 | 25 | 50>(25);
  const [auditFilter, setAuditFilter] = useState<AuditHistoryFilter>("all");
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<ManagedIntegrationRecord[]>(
    [],
  );
  const [integrationDrafts, setIntegrationDrafts] = useState<
    Record<ManagedIntegrationProvider, IntegrationDraftState>
  >({
    shopify: createIntegrationDraft(),
    shiphero: createIntegrationDraft(),
  });
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [savingIntegrationProvider, setSavingIntegrationProvider] =
    useState<ManagedIntegrationProvider | null>(null);
  const [integrationStatusMessage, setIntegrationStatusMessage] = useState<
    string | null
  >(null);
  const [integrationStatusTone, setIntegrationStatusTone] = useState<
    "error" | "success" | null
  >(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [shopifySyncResult, setShopifySyncResult] = useState<{
    synced: number;
    skipped: number;
    errors: number;
  } | null>(null);

  useEffect(() => {
    setDrafts((currentDrafts) => {
      const nextDrafts: Record<string, DraftItemState> = {};

      for (const item of items) {
        nextDrafts[item.id] = currentDrafts[item.id] ?? createDraftState(item);
      }

      return nextDrafts;
    });
  }, [items]);

  useEffect(() => {
    setIntegrationDrafts(() => {
      const nextDrafts = {
        shopify: createIntegrationDraft(),
        shiphero: createIntegrationDraft(),
      };

      for (const provider of managedIntegrationProviders) {
        const integration = integrations.find(
          (candidate) => candidate.provider === provider,
        );

        nextDrafts[provider] = createIntegrationDraft(integration ?? undefined);
      }

      return nextDrafts;
    });
  }, [integrations]);

  const refreshIntegrations = useCallback(async () => {
    if (!tenantId) {
      setIntegrations([]);
      setIntegrationError(
        "No tenant is configured for this account yet. Complete onboarding or assign app_metadata.tenant_id for the user.",
      );
      setIntegrationLoading(false);
      return;
    }

    try {
      setIntegrationLoading(true);
      const response = await fetch(
        `/api/integrations?tenantId=${encodeURIComponent(tenantId)}`,
      );
      const responseText = await response.text();
      const payload = (responseText ? JSON.parse(responseText) : {}) as {
        error?: string;
        integrations?: ManagedIntegrationRecord[];
      };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load integrations.");
      }

      setIntegrations(payload.integrations ?? []);
      setIntegrationError(null);
    } catch (loadError) {
      console.error("Error fetching integrations:", loadError);
      setIntegrationError(
        loadError instanceof Error
          ? loadError.message
          : "Unknown error while loading integrations.",
      );
    } finally {
      setIntegrationLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refreshIntegrations();
  }, [refreshIntegrations]);

  const refreshQueueStatus = useCallback(async () => {
    if (!tenantId) {
      setQueueStatus(null);
      setQueueLoading(false);
      return;
    }

    try {
      setQueueLoading(true);
      const response = await fetch("/api/queue/status");
      const responseText = await response.text();
      const payload = (responseText ? JSON.parse(responseText) : {}) as
        | QueueStatus
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          ("error" in payload && payload.error) ||
            "Unable to load queue status.",
        );
      }

      setQueueStatus(payload as QueueStatus);
      setQueueError(null);
    } catch (fetchError) {
      setQueueError(
        fetchError instanceof Error
          ? fetchError.message
          : "Unknown error loading queue status.",
      );
    } finally {
      setQueueLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refreshQueueStatus();
    const interval = setInterval(() => void refreshQueueStatus(), 30_000);
    return () => clearInterval(interval);
  }, [refreshQueueStatus]);

  const refreshAuditHistory = useCallback(async () => {
    if (!tenantId) {
      setAuditHistory([]);
      setAuditError(
        "No tenant is configured for this account yet. Complete onboarding or assign app_metadata.tenant_id for the user.",
      );
      setAuditLoading(false);
      return;
    }

    try {
      setAuditLoading(true);
      const response = await fetch(
        `/api/inventory/audit?tenantId=${encodeURIComponent(tenantId)}&limit=50`,
      );
      const responseText = await response.text();
      const payload = (responseText ? JSON.parse(responseText) : {}) as {
        error?: string;
        history?: InventoryAuditEntry[];
      };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load audit history.");
      }

      setAuditHistory(payload.history ?? []);
      setAuditError(null);
    } catch (historyError) {
      console.error("Error fetching audit history:", historyError);
      setAuditError(
        historyError instanceof Error
          ? historyError.message
          : "Unknown error while loading audit history.",
      );
    } finally {
      setAuditLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refreshAuditHistory();
  }, [refreshAuditHistory]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return items;
    }

    return items.filter((item) => {
      const haystacks = [
        item.sku,
        item.shopify_product_id,
        item.shopify_variant_id,
      ];

      return haystacks.some((value) =>
        value?.toLowerCase().includes(normalizedSearch),
      );
    });
  }, [items, searchTerm]);

  const filteredAuditHistory = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return auditHistory.filter((entry) => {
      const changeSummary = summarizeAuditChanges(entry)
        .join(" ")
        .toLowerCase();
      const matchingItem = items.find(
        (item) => item.id === entry.inventory_item_id,
      );
      const isSyncEntry =
        entry.source === "shiphero" || entry.source === "shopify";
      const isOperatorEntry =
        Boolean(entry.actor_user_id) ||
        (Boolean(entry.actor_role) && entry.actor_role !== "database_trigger");
      const isExceptionEntry = Boolean(
        entry.source === "shiphero" ||
        (matchingItem &&
          (matchingItem.flash_mode_enabled ||
            matchingItem.total_quantity -
              matchingItem.committed_quantity -
              matchingItem.safety_floor_quantity <=
              0)),
      );
      const haystacks = [
        entry.itemLabel,
        entry.itemProductId,
        entry.itemSku,
        entry.action,
        entry.source,
        changeSummary,
      ];

      const matchesSearch = normalizedSearch
        ? haystacks.some((value) =>
            value?.toLowerCase().includes(normalizedSearch),
          )
        : true;

      if (!matchesSearch) {
        return false;
      }

      if (auditFilter === "syncs") {
        return isSyncEntry;
      }

      if (auditFilter === "operator") {
        return isOperatorEntry;
      }

      if (auditFilter === "exceptions") {
        return isExceptionEntry;
      }

      return true;
    });
  }, [auditFilter, auditHistory, items, searchTerm]);

  const visibleAuditHistory = useMemo(
    () => filteredAuditHistory.slice(0, auditDisplayLimit),
    [auditDisplayLimit, filteredAuditHistory],
  );

  const integrationCards = useMemo(
    () =>
      managedIntegrationProviders.map((provider) => ({
        draft: integrationDrafts[provider] ?? createIntegrationDraft(),
        integration:
          integrations.find((candidate) => candidate.provider === provider) ??
          null,
        shipheroWebhookStatus:
          provider === "shiphero"
            ? getShipHeroWebhookStatus(
                integrations.find(
                  (candidate) => candidate.provider === provider,
                ) ?? null,
              )
            : null,
        provider,
      })),
    [integrationDrafts, integrations],
  );

  const reconciliationSnapshot = useMemo(() => {
    const itemSummaries = items.map((item) => {
      const availableToSell =
        item.total_quantity -
        item.committed_quantity -
        item.safety_floor_quantity;
      const commitmentRatio =
        item.total_quantity > 0
          ? item.committed_quantity / item.total_quantity
          : item.committed_quantity > 0
            ? 1
            : 0;
      const atOrBelowFloor = availableToSell <= 0;
      const needsReview =
        item.flash_mode_enabled || atOrBelowFloor || commitmentRatio >= 0.8;

      return {
        atOrBelowFloor,
        availableToSell,
        commitmentRatio,
        item,
        needsReview,
      };
    });

    const recentSyncActivity = auditHistory.filter(
      (entry) => entry.source === "shiphero" || entry.source === "shopify",
    );

    return {
      activeFlashModeCount: itemSummaries.filter(
        (summary) => summary.item.flash_mode_enabled,
      ).length,
      attentionItems: itemSummaries
        .filter((summary) => summary.needsReview)
        .sort((left, right) => {
          if (left.availableToSell !== right.availableToSell) {
            return left.availableToSell - right.availableToSell;
          }

          return right.commitmentRatio - left.commitmentRatio;
        })
        .slice(0, 5),
      averageCommitmentRatio:
        itemSummaries.length > 0
          ? itemSummaries.reduce(
              (total, summary) => total + summary.commitmentRatio,
              0,
            ) / itemSummaries.length
          : 0,
      floorRiskCount: itemSummaries.filter((summary) => summary.atOrBelowFloor)
        .length,
      recentSyncActivity,
    };
  }, [auditHistory, items]);

  const shipheroRecoveryStatus = useMemo(
    () =>
      getShipHeroWebhookStatus(
        integrations.find((candidate) => candidate.provider === "shiphero") ??
          null,
      ),
    [integrations],
  );

  const exceptionHighlights = useMemo(() => {
    const highlights = [] as Array<{
      body: string;
      eyebrow: string;
      footer: string | null;
      title: string;
      tone: "amber" | "slate";
    }>;

    if (
      shipheroRecoveryStatus?.lastResult ||
      shipheroRecoveryStatus?.lastError
    ) {
      highlights.push({
        body:
          shipheroRecoveryStatus.lastError ??
          shipheroRecoveryStatus.operatorAction ??
          "ShipHero webhook state is available for review.",
        eyebrow: "ShipHero recovery",
        footer: shipheroRecoveryStatus.retryCommand
          ? `Suggested replay: ${shipheroRecoveryStatus.retryCommand}`
          : shipheroRecoveryStatus.operatorAction,
        title: shipheroRecoveryStatus.retryRecommended
          ? "Warehouse sync needs follow-up"
          : "Latest warehouse sync is stable",
        tone: shipheroRecoveryStatus.retryRecommended ? "amber" : "slate",
      });
    }

    for (const summary of reconciliationSnapshot.attentionItems.slice(0, 2)) {
      highlights.push({
        body: `${summary.item.sku ?? summary.item.shopify_product_id} has ${summary.availableToSell} units available after commitments and floor protection.`,
        eyebrow: "Inventory exception",
        footer: `Commitment load ${formatPercent(summary.commitmentRatio)}. Flash mode ${summary.item.flash_mode_enabled ? "on" : "off"}.`,
        title: summary.item.flash_mode_enabled
          ? "Flash mode item still needs review"
          : "Low sellable buffer",
        tone: "amber",
      });
    }

    return highlights.slice(0, 3);
  }, [reconciliationSnapshot.attentionItems, shipheroRecoveryStatus]);

  function updateDraft(
    itemId: string,
    field: keyof DraftItemState,
    value: string | boolean,
  ) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [itemId]: {
        ...(currentDrafts[itemId] ?? {
          flashModeEnabled: false,
          safetyFloorPercent: "0",
          totalQuantity: "0",
        }),
        [field]: value,
      },
    }));
  }

  function updateIntegrationDraft(
    provider: ManagedIntegrationProvider,
    field: keyof IntegrationDraftState,
    value: string,
  ) {
    setIntegrationDrafts((currentDrafts) => ({
      ...currentDrafts,
      [provider]: {
        ...(currentDrafts[provider] ?? createIntegrationDraft()),
        [field]: value,
      },
    }));
  }

  async function saveIntegration(provider: ManagedIntegrationProvider) {
    const draft = integrationDrafts[provider] ?? createIntegrationDraft();

    if (
      provider === "shopify" &&
      draft.status === "active" &&
      !draft.externalShopDomain.trim()
    ) {
      setIntegrationStatusTone("error");
      setIntegrationStatusMessage(
        "Active Shopify integrations require a shop domain.",
      );
      return;
    }

    if (
      provider === "shiphero" &&
      draft.status === "active" &&
      !draft.externalAccountId.trim()
    ) {
      setIntegrationStatusTone("error");
      setIntegrationStatusMessage(
        "Active ShipHero integrations require an external account ID.",
      );
      return;
    }

    setSavingIntegrationProvider(provider);
    setIntegrationStatusMessage(null);
    setIntegrationStatusTone(null);

    try {
      const response = await fetch("/api/integrations", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          apiKey: draft.apiKey,
          apiSecret: draft.apiSecret,
          displayName: draft.displayName,
          externalAccountId: draft.externalAccountId,
          externalShopDomain: draft.externalShopDomain,
          provider,
          shopifyLocationId:
            provider === "shopify" ? draft.shopifyLocationId : undefined,
          status: draft.status,
          webhookSecret: draft.webhookSecret,
        }),
      });
      const responseText = await response.text();
      const payload = (responseText ? JSON.parse(responseText) : {}) as {
        error?: string;
        integration?: ManagedIntegrationRecord;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to save integration.");
      }

      if (payload.integration) {
        setIntegrationDrafts((currentDrafts) => ({
          ...currentDrafts,
          [provider]: createIntegrationDraft(payload.integration),
        }));
      }

      await refreshIntegrations();
      setIntegrationStatusTone("success");
      setIntegrationStatusMessage(
        `Saved ${provider === "shopify" ? "Shopify" : "ShipHero"} integration settings.`,
      );
    } catch (saveError) {
      console.error("Error saving integration:", saveError);
      setIntegrationStatusTone("error");
      setIntegrationStatusMessage(
        saveError instanceof Error
          ? saveError.message
          : "Unknown error while saving integration.",
      );
    } finally {
      setSavingIntegrationProvider(null);
    }
  }

  async function runShopifySync() {
    setShopifySyncing(true);
    setShopifySyncResult(null);

    try {
      const response = await fetch("/api/inventory/shopify-sync", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        synced?: number;
        skipped?: number;
        errors?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Shopify sync failed.");
      }

      setShopifySyncResult({
        synced: payload.synced ?? 0,
        skipped: payload.skipped ?? 0,
        errors: payload.errors ?? 0,
      });
    } catch (err) {
      setShopifySyncResult({ synced: 0, skipped: 0, errors: 1 });
      console.error("Shopify sync error:", err);
    } finally {
      setShopifySyncing(false);
    }
  }

  async function saveItem(item: InventoryItem) {
    const draft = drafts[item.id] ?? createDraftState(item);
    const totalQuantity = Number(draft.totalQuantity);
    const safetyFloorPercent = Number(draft.safetyFloorPercent);

    if (!Number.isInteger(totalQuantity) || totalQuantity < 0) {
      setStatusTone("error");
      setStatusMessage(
        `Enter a non-negative whole number for ${item.sku ?? item.shopify_product_id}.`,
      );
      return;
    }

    if (
      Number.isNaN(safetyFloorPercent) ||
      safetyFloorPercent < 0 ||
      safetyFloorPercent > 100
    ) {
      setStatusTone("error");
      setStatusMessage(
        `Enter a safety floor between 0 and 100 for ${item.sku ?? item.shopify_product_id}.`,
      );
      return;
    }

    setSavingItemId(item.id);
    setStatusMessage(null);
    setStatusTone(null);

    try {
      const response = await fetch("/api/inventory", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          itemId: item.id,
          totalQuantity,
          safetyFloorPercent,
          flashModeEnabled: draft.flashModeEnabled,
        }),
      });
      const responseText = await response.text();
      const payload = (responseText ? JSON.parse(responseText) : {}) as {
        error?: string;
        item?: InventoryItem;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to save inventory changes.");
      }

      const updatedItem = payload.item;

      if (updatedItem) {
        setDrafts((currentDrafts) => ({
          ...currentDrafts,
          [updatedItem.id]: createDraftState(updatedItem),
        }));
      }

      await Promise.all([refresh(), refreshAuditHistory()]);
      setStatusTone("success");
      setStatusMessage(
        `Saved operator controls for ${item.sku ?? item.shopify_product_id}.`,
      );
    } catch (saveError) {
      console.error("Error saving inventory item:", saveError);
      setStatusTone("error");
      setStatusMessage(
        saveError instanceof Error
          ? saveError.message
          : "Unknown error while saving inventory item.",
      );
    } finally {
      setSavingItemId(null);
    }
  }

  if (loading) return <p>Loading Warehouse Data...</p>;

  if (error) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <p className="font-semibold">Inventory unavailable</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
        No inventory records found for tenant {tenantId}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Operator controls
            </p>
            <p className="text-sm text-slate-600">
              Search inventory and save on-hand quantity, safety floor, and
              flash mode per item.
            </p>
          </div>
          <label className="flex w-full max-w-sm flex-col gap-1 text-sm text-slate-700">
            Search inventory
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Filter by SKU, product, or variant"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-0 transition focus:border-slate-500"
            />
          </label>
        </div>

        {statusMessage ? (
          <div
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              statusTone === "error"
                ? "border border-rose-200 bg-rose-50 text-rose-900"
                : "border border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {statusMessage}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-slate-900">
            Integration management
          </p>
          <p className="text-sm text-slate-600">
            Configure tenant-scoped Shopify and ShipHero credentials, webhook
            secrets, and activation state.
          </p>
        </div>

        {integrationStatusMessage ? (
          <div
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              integrationStatusTone === "error"
                ? "border border-rose-200 bg-rose-50 text-rose-900"
                : "border border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {integrationStatusMessage}
          </div>
        ) : null}

        {integrationLoading ? (
          <p className="mt-4 text-sm text-slate-600">
            Loading integration settings...
          </p>
        ) : null}

        {integrationError ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {integrationError}
          </div>
        ) : null}

        {!integrationLoading && !integrationError ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {integrationCards.map(
              ({ provider, integration, draft, shipheroWebhookStatus }) => {
                const title = provider === "shopify" ? "Shopify" : "ShipHero";

                return (
                  <div
                    key={provider}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">
                          {title}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {provider === "shopify"
                            ? "Manage storefront webhook identity and shared secrets."
                            : "Manage warehouse webhook identity and API credentials."}
                        </p>
                      </div>
                      <div className="text-xs text-slate-500">
                        <p>Status: {integration?.status ?? "draft"}</p>
                        <p>
                          Last synced:{" "}
                          {integration?.last_synced_at
                            ? new Date(
                                integration.last_synced_at,
                              ).toLocaleString()
                            : "Never"}
                        </p>
                      </div>
                    </div>

                    {integration?.last_error ? (
                      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                        Last error: {integration.last_error}
                      </div>
                    ) : null}

                    {provider === "shiphero" && shipheroWebhookStatus ? (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                        <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="font-semibold text-slate-900">
                              Webhook recovery plan
                            </p>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              {shipheroWebhookStatus.lastResult ?? "Unknown"}{" "}
                              {shipheroWebhookStatus.lastWebhookType ??
                                "ShipHero webhook"}
                            </p>
                          </div>
                          <p className="text-xs text-slate-500">
                            {shipheroWebhookStatus.lastAttemptAt
                              ? new Date(
                                  shipheroWebhookStatus.lastAttemptAt,
                                ).toLocaleString()
                              : "No webhook attempts recorded yet"}
                          </p>
                        </div>

                        <div className="mt-3 grid gap-1 text-sm">
                          <p>
                            Outcome: {shipheroWebhookStatus.succeeded} succeeded
                            / {shipheroWebhookStatus.failed} failed across{" "}
                            {shipheroWebhookStatus.lineItems} line items.
                          </p>
                          {shipheroWebhookStatus.operatorAction ? (
                            <p>{shipheroWebhookStatus.operatorAction}</p>
                          ) : null}
                          {shipheroWebhookStatus.retryCommand ? (
                            <p>
                              Replay command:{" "}
                              {shipheroWebhookStatus.retryCommand}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <form
                      className="mt-4 grid gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveIntegration(provider);
                      }}
                    >
                      <label className="flex flex-col gap-1 text-sm text-slate-700">
                        Display name
                        <input
                          value={draft.displayName}
                          onChange={(event) =>
                            updateIntegrationDraft(
                              provider,
                              "displayName",
                              event.target.value,
                            )
                          }
                          placeholder={`${title} connection`}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                        />
                      </label>

                      <label className="flex flex-col gap-1 text-sm text-slate-700">
                        Status
                        <select
                          value={draft.status}
                          onChange={(event) =>
                            updateIntegrationDraft(
                              provider,
                              "status",
                              event.target.value,
                            )
                          }
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                        >
                          <option value="draft">Draft</option>
                          <option value="active">Active</option>
                          <option value="disabled">Disabled</option>
                          <option value="error">Error</option>
                        </select>
                      </label>

                      <label className="flex flex-col gap-1 text-sm text-slate-700">
                        {provider === "shopify"
                          ? "Shop domain"
                          : "External account ID"}
                        <input
                          value={
                            provider === "shopify"
                              ? draft.externalShopDomain
                              : draft.externalAccountId
                          }
                          onChange={(event) =>
                            updateIntegrationDraft(
                              provider,
                              provider === "shopify"
                                ? "externalShopDomain"
                                : "externalAccountId",
                              event.target.value,
                            )
                          }
                          placeholder={
                            provider === "shopify"
                              ? "demo-shop.myshopify.com"
                              : "demo-shiphero-account"
                          }
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                        />
                      </label>

                      {provider === "shopify" ? (
                        <label className="flex flex-col gap-1 text-sm text-slate-700">
                          External account ID
                          <input
                            value={draft.externalAccountId}
                            onChange={(event) =>
                              updateIntegrationDraft(
                                provider,
                                "externalAccountId",
                                event.target.value,
                              )
                            }
                            placeholder="demo-shop"
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                          />
                        </label>
                      ) : null}

                      <label className="flex flex-col gap-1 text-sm text-slate-700">
                        Webhook secret
                        <input
                          type="password"
                          value={draft.webhookSecret}
                          onChange={(event) =>
                            updateIntegrationDraft(
                              provider,
                              "webhookSecret",
                              event.target.value,
                            )
                          }
                          placeholder="replace-for-local-testing"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                        />
                      </label>

                      {provider === "shopify" ? (
                        <label className="flex flex-col gap-1 text-sm text-slate-700">
                          Inventory location ID
                          <input
                            value={draft.shopifyLocationId}
                            onChange={(event) =>
                              updateIntegrationDraft(
                                provider,
                                "shopifyLocationId",
                                event.target.value,
                              )
                            }
                            placeholder="12345678"
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                          />
                          <span className="text-xs text-slate-400">
                            Numeric Shopify location ID required for outbound
                            inventory sync.
                          </span>
                        </label>
                      ) : null}

                      {provider === "shiphero" ? (
                        <>
                          <label className="flex flex-col gap-1 text-sm text-slate-700">
                            API key
                            <input
                              value={draft.apiKey}
                              onChange={(event) =>
                                updateIntegrationDraft(
                                  provider,
                                  "apiKey",
                                  event.target.value,
                                )
                              }
                              placeholder="ShipHero API key"
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                            />
                          </label>

                          <label className="flex flex-col gap-1 text-sm text-slate-700">
                            API secret
                            <input
                              type="password"
                              value={draft.apiSecret}
                              onChange={(event) =>
                                updateIntegrationDraft(
                                  provider,
                                  "apiSecret",
                                  event.target.value,
                                )
                              }
                              placeholder="ShipHero API secret"
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                            />
                          </label>
                        </>
                      ) : null}

                      <button
                        type="submit"
                        disabled={savingIntegrationProvider === provider}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        {savingIntegrationProvider === provider
                          ? "Saving..."
                          : `Save ${title}`}
                      </button>
                    </form>

                    {provider === "shopify" ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => void runShopifySync()}
                          disabled={shopifySyncing}
                          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                        >
                          {shopifySyncing
                            ? "Syncing to Shopify..."
                            : "Sync inventory to Shopify"}
                        </button>
                        {shopifySyncResult ? (
                          <p className="text-xs text-slate-500">
                            Last sync: {shopifySyncResult.synced} synced,{" "}
                            {shopifySyncResult.skipped} skipped,{" "}
                            {shopifySyncResult.errors} errors.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              },
            )}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-slate-900">
            Reconciliation snapshot
          </p>
          <p className="text-sm text-slate-600">
            Surface the inventory rows most likely to need operator review
            before a warehouse or storefront mismatch turns into a customer
            issue.
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              At Or Below Floor
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {reconciliationSnapshot.floorRiskCount}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Items with no sellable buffer left after committed units and
              safety floor.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Flash Mode Active
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {reconciliationSnapshot.activeFlashModeCount}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Inventory rows currently protected with manual flash mode.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Avg Commitment Load
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatPercent(reconciliationSnapshot.averageCommitmentRatio)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Average share of on-hand stock already committed across tracked
              rows.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                Needs review first
              </p>
              <p className="text-xs text-slate-500">
                Based on flash mode, available buffer, and commitment load
              </p>
            </div>

            {reconciliationSnapshot.attentionItems.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">
                No inventory rows are currently flagged for immediate review.
              </p>
            ) : (
              <div className="mt-4 grid gap-3">
                {reconciliationSnapshot.attentionItems.map((summary) => (
                  <div
                    key={summary.item.id}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-3"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {summary.item.sku || summary.item.shopify_product_id}
                        </p>
                        <p className="text-xs text-slate-500">
                          Variant: {summary.item.shopify_variant_id}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500">
                        Updated:{" "}
                        {summary.item.updated_at
                          ? new Date(summary.item.updated_at).toLocaleString()
                          : "Unknown"}
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-700">
                      <span>Available: {summary.availableToSell}</span>
                      <span>
                        Commitment load:{" "}
                        {formatPercent(summary.commitmentRatio)}
                      </span>
                      <span>
                        Flash mode:{" "}
                        {summary.item.flash_mode_enabled ? "On" : "Off"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                Exception workflow
              </p>
              <p className="text-xs text-slate-500">
                Recovery and operator follow-up right now
              </p>
            </div>

            {exceptionHighlights.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">
                No warehouse or inventory exceptions are currently open.
              </p>
            ) : (
              <div className="mt-4 grid gap-3">
                {exceptionHighlights.map((highlight, index) => (
                  <div
                    key={`${highlight.title}-${index}`}
                    className={`rounded-lg border px-3 py-3 ${
                      highlight.tone === "amber"
                        ? "border-amber-300 bg-amber-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {highlight.eyebrow}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {highlight.title}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      {highlight.body}
                    </p>
                    {highlight.footer ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {highlight.footer}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  Recent sync activity
                </p>
                <p className="text-xs text-slate-500">
                  Latest Shopify and ShipHero mutations
                </p>
              </div>

              {reconciliationSnapshot.recentSyncActivity.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">
                  No recent webhook-driven inventory mutations are available
                  yet.
                </p>
              ) : (
                <div className="mt-4 grid gap-3">
                  {reconciliationSnapshot.recentSyncActivity
                    .slice(0, 5)
                    .map((entry) => {
                      const changes = summarizeAuditChanges(entry).slice(0, 2);

                      return (
                        <div
                          key={entry.id}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-3"
                        >
                          <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {entry.itemLabel ?? "Unknown inventory item"}
                              </p>
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                {entry.source} {entry.action}
                              </p>
                            </div>
                            <p className="text-xs text-slate-500">
                              {new Date(entry.created_at).toLocaleString()}
                            </p>
                          </div>

                          {changes.length > 0 ? (
                            <div className="mt-2 grid gap-1 text-sm text-slate-700">
                              {changes.map((change) => (
                                <p key={`${entry.id}-${change}`}>{change}</p>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-slate-600">
                              No field-level diff was captured for this sync.
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-slate-900">Queue health</p>
            <p className="text-sm text-slate-600">
              Webhook event processing status across all pipeline stages for
              this tenant.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshQueueStatus()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {queueLoading ? (
          <p className="mt-4 text-sm text-slate-600">Loading queue status...</p>
        ) : null}

        {queueError ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {queueError}
          </div>
        ) : null}

        {!queueLoading && !queueError && queueStatus ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              {(
                [
                  ["Pending", "pending", "text-blue-600"],
                  ["Processing", "processing", "text-amber-600"],
                  ["Succeeded", "succeeded", "text-emerald-600"],
                  ["Failed", "failed", "text-rose-600"],
                  ["Dead Letter", "dead_letter", "text-rose-900"],
                ] as const
              ).map(([label, key, colorClass]) => (
                <div
                  key={key}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {label}
                  </p>
                  <p className={`mt-2 text-2xl font-semibold ${colorClass}`}>
                    {queueStatus.counts[key]}
                  </p>
                </div>
              ))}
            </div>

            {queueStatus.recentFailed.length > 0 ? (
              <div className="mt-4">
                <p className="text-sm font-semibold text-slate-900">
                  Recent failures
                </p>
                <div className="mt-3 grid gap-2">
                  {queueStatus.recentFailed.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"
                    >
                      <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {event.provider} / {event.event_type}
                          </p>
                          {event.last_error ? (
                            <p className="mt-1 text-sm text-rose-800">
                              {event.last_error}
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right text-xs text-slate-500">
                          <p>
                            Attempt {event.attempts} of {event.max_attempts}
                          </p>
                          <p>{new Date(event.updated_at).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">
                No failed webhook events in the queue.
              </p>
            )}
          </>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-slate-900">
              Recent audit history
            </p>
            <p className="text-sm text-slate-600">
              Review the latest tenant-scoped inventory mutations from webhook
              syncs and manual operator changes.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              History focus
              <select
                value={auditFilter}
                onChange={(event) =>
                  setAuditFilter(event.target.value as AuditHistoryFilter)
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
              >
                <option value="all">All activity</option>
                <option value="syncs">Sync-only</option>
                <option value="operator">Operator-only</option>
                <option value="exceptions">Exception trail</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm text-slate-700">
              Show entries
              <select
                value={auditDisplayLimit}
                onChange={(event) =>
                  setAuditDisplayLimit(
                    Number(event.target.value) as 12 | 25 | 50,
                  )
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
              >
                <option value={12}>12</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>
        </div>

        {auditLoading ? (
          <p className="mt-4 text-sm text-slate-600">
            Loading audit history...
          </p>
        ) : null}

        {auditError ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {auditError}
          </div>
        ) : null}

        {!auditLoading && !auditError && filteredAuditHistory.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            No audit entries match the current filter.
          </p>
        ) : null}

        {!auditLoading && !auditError && filteredAuditHistory.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {visibleAuditHistory.map((entry) => {
              const changes = summarizeAuditChanges(entry);

              return (
                <div
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {entry.itemLabel ?? "Unknown inventory item"}
                      </p>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        {entry.action} via {entry.source}
                      </p>
                    </div>
                    <p className="text-xs text-slate-500">
                      {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                    {entry.itemProductId ? (
                      <span>Product: {entry.itemProductId}</span>
                    ) : null}
                    {entry.actor_role ? (
                      <span>Actor role: {entry.actor_role}</span>
                    ) : null}
                    {entry.actor_user_id ? (
                      <span>User: {entry.actor_user_id}</span>
                    ) : null}
                  </div>

                  {changes.length > 0 ? (
                    <div className="mt-3 grid gap-2 text-sm text-slate-700">
                      {changes.map((change) => (
                        <p key={`${entry.id}-${change}`}>{change}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">
                      No field-level diff was captured for this entry.
                    </p>
                  )}
                </div>
              );
            })}

            {filteredAuditHistory.length > visibleAuditHistory.length ? (
              <p className="text-sm text-slate-500">
                Showing {visibleAuditHistory.length} of{" "}
                {filteredAuditHistory.length} matching audit entries.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-slate-700">
          No inventory items match “{searchTerm}”.
        </div>
      ) : null}

      <div className="grid gap-4">
        {filteredItems.map((item) => {
          const draft = drafts[item.id] ?? createDraftState(item);
          const availableToSell =
            item.total_quantity -
            item.committed_quantity -
            item.safety_floor_quantity;

          return (
            <div
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-bold">
                    {item.sku || item.shopify_product_id}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Product: {item.shopify_product_id} | Variant:{" "}
                    {item.shopify_variant_id}
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  Updated:{" "}
                  {item.updated_at
                    ? new Date(item.updated_at).toLocaleString()
                    : "Unknown"}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <span>On-Hand: {item.total_quantity}</span>
                <span className="text-blue-600">
                  Committed: {item.committed_quantity}
                </span>
                <span className="text-green-600 font-bold">
                  Available: {availableToSell}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Safety Floor: {item.safety_floor_quantity} | Flash Mode:{" "}
                {item.flash_mode_enabled ? "On" : "Off"}
              </div>

              <form
                className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveItem(item);
                }}
              >
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  On-hand quantity
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.totalQuantity}
                    onChange={(event) =>
                      updateDraft(item.id, "totalQuantity", event.target.value)
                    }
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  Safety floor %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={draft.safetyFloorPercent}
                    onChange={(event) =>
                      updateDraft(
                        item.id,
                        "safetyFloorPercent",
                        event.target.value,
                      )
                    }
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                  />
                </label>

                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={draft.flashModeEnabled}
                    onChange={(event) =>
                      updateDraft(
                        item.id,
                        "flashModeEnabled",
                        event.target.checked,
                      )
                    }
                  />
                  Flash mode
                </label>

                <button
                  type="submit"
                  disabled={savingItemId === item.id}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {savingItemId === item.id ? "Saving..." : "Save"}
                </button>
              </form>
            </div>
          );
        })}
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span>
            Page {page} of {totalPages} ({total} items)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1 || loading}
              className="rounded-lg border border-slate-300 px-3 py-1 text-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages || loading}
              className="rounded-lg border border-slate-300 px-3 py-1 text-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
