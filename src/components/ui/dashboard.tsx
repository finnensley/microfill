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
  status: "draft" | "active" | "disabled" | "error";
  webhookSecret: string;
};

function createIntegrationDraft(
  integration?: ManagedIntegrationRecord,
): IntegrationDraftState {
  return {
    apiKey: integration?.api_key ?? "",
    apiSecret: integration?.api_secret ?? "",
    displayName: integration?.display_name ?? "",
    externalAccountId: integration?.external_account_id ?? "",
    externalShopDomain: integration?.external_shop_domain ?? "",
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

export default function InventoryDashboard({
  tenantId,
}: InventoryDashboardProps) {
  const { items, loading, error, refresh } = useInventory(
    tenantId || undefined,
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftItemState>>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"error" | "success" | null>(
    null,
  );
  const [auditHistory, setAuditHistory] = useState<InventoryAuditEntry[]>([]);
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
        `/api/inventory/audit?tenantId=${encodeURIComponent(tenantId)}&limit=12`,
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

    if (!normalizedSearch) {
      return auditHistory;
    }

    return auditHistory.filter((entry) => {
      const changeSummary = summarizeAuditChanges(entry)
        .join(" ")
        .toLowerCase();
      const haystacks = [
        entry.itemLabel,
        entry.itemProductId,
        entry.itemSku,
        entry.action,
        entry.source,
        changeSummary,
      ];

      return haystacks.some((value) =>
        value?.toLowerCase().includes(normalizedSearch),
      );
    });
  }, [auditHistory, searchTerm]);

  const integrationCards = useMemo(
    () =>
      managedIntegrationProviders.map((provider) => ({
        draft: integrationDrafts[provider] ?? createIntegrationDraft(),
        integration:
          integrations.find((candidate) => candidate.provider === provider) ??
          null,
        provider,
      })),
    [integrationDrafts, integrations],
  );

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

      if (payload.item) {
        setDrafts((currentDrafts) => ({
          ...currentDrafts,
          [payload.item.id]: createDraftState(payload.item),
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
            {integrationCards.map(({ provider, integration, draft }) => {
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
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-slate-900">
            Recent audit history
          </p>
          <p className="text-sm text-slate-600">
            Review the latest tenant-scoped inventory mutations from webhook
            syncs and manual operator changes.
          </p>
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
            {filteredAuditHistory.map((entry) => {
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
    </div>
  );
}
