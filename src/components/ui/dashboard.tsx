"use client";
import { useEffect, useMemo, useState } from "react";
import { useInventory } from "@/hooks/use-inventory";
import { InventoryItem } from "@/types/inventory";

interface InventoryDashboardProps {
  tenantId: string | null;
}

type DraftItemState = {
  flashModeEnabled: boolean;
  safetyFloorPercent: string;
  totalQuantity: string;
};

function createDraftState(item: InventoryItem): DraftItemState {
  return {
    totalQuantity: String(item.total_quantity),
    safetyFloorPercent: String(item.safety_floor_percent),
    flashModeEnabled: Boolean(item.flash_mode_enabled),
  };
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

  useEffect(() => {
    setDrafts((currentDrafts) => {
      const nextDrafts: Record<string, DraftItemState> = {};

      for (const item of items) {
        nextDrafts[item.id] = currentDrafts[item.id] ?? createDraftState(item);
      }

      return nextDrafts;
    });
  }, [items]);

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

      await refresh();
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
